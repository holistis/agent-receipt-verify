// Onafhankelijke verificatie van het x402 offer-receipt autorisatie-commitment.
//
// Geschreven tegen de spec-tekst van de extensie (§5.6 Authorization Commitment),
// niet tegen een implementatie. Het commitment bindt een bonnetje aan precies één
// afrekening op de keten, zonder dat het bonnetje die afrekening prijsgeeft.
//
// Waarom dit ertoe doet: sinds §5.6.5 (16 oktober 2026) staat in de spec dat een
// consument die afrekeningen telt ALLEEN geopende commitments mag tellen. Zolang een
// commitment dicht is, is het een uitspraak van de ondertekenaar over zichzelf: hij
// kan twee bonnetjes maken voor één afrekening, of een bonnetje dat nergens op
// uitkomt. Openen is dus geen formaliteit maar het moment waarop een bewering bewijs
// wordt, en dat is precies wat hier narekenbaar wordt gemaakt.

import { createHash } from 'node:crypto'

const TAG = Buffer.from('x402-receipt-authorization/0', 'ascii')
const NUL = Buffer.from([0])

// De lengte is VERPLICHT, niet optioneel. Eerder was `verwacht === undefined` stil
// toegestaan, en dan deed deze functie niets anders dan hex naar bytes omzetten. Dat
// was precies het gat dat hieronder beschreven staat: zodra `lengtes` per ongeluk geen
// object was, viel elke lengtecontrole weg zonder dat er iets te zien was.
const bytes = (h, naam, verwacht) => {
  if (!Number.isInteger(verwacht) || verwacht <= 0) {
    throw new Error(`geen lengte-eis bekend voor ${naam}, dus dit veld wordt niet geaccepteerd`)
  }
  const b = Buffer.from(String(h ?? '').replace(/^0x/, ''), 'hex')
  if (b.length !== verwacht) {
    throw new Error(`${naam} moet ${verwacht} bytes zijn, kreeg ${b.length}`)
  }
  return b
}

// De bekende methoden, met de lengte-eis per veld.
//
// WAAROM DIT EEN APARTE TABEL IS EN MET hasOwn WORDT OPGEZOCHT. Dit stond als
// `{ eip3009: {...} }[method]` in de functie zelf, en dat is een opzoeking die ook de
// PROTOTYPEKETEN raakt. Zelf gemeten op de gepubliceerde versie: `constructor`,
// `toString`, `valueOf`, `hasOwnProperty` en `__proto__` kwamen alle vijf door de
// `!lengtes`-poort, want ze geven een functie terug en een functie is waar. Daarna was
// `lengtes.asset` undefined en viel elke lengtecontrole weg, en dan zijn de velden
// zonder scheiding aan elkaar geplakt. De botsing is echt en narekenbaar:
//
//   method constructor, asset 0xaabb, authorizer 0xcc
//   method constructor, asset 0xaa,   authorizer 0xbbcc
//   geven BEIDE 0xd7f3867bb7a62bc13ba3e5e332c2109f3dc397d94c2f0d8c1238b8d87faa3836
//
// Twee verschillende afrekeningen die hetzelfde commitment opleveren is exact wat een
// commitment moet uitsluiten, dus dit is geen schoonheidsfoutje.
const LENGTES = { eip3009: { asset: 20, authorizer: 20 } }

/** Is dit een methode die wij echt kennen, en niet iets uit de prototypeketen? */
export function kentMethode(method) {
  return typeof method === 'string' && Object.hasOwn(LENGTES, method)
}

// §5.6.2. Elk veld na `method` heeft een vaste lengte, dus het voorbeeld is
// ondubbelzinnig. Lengtes worden hier afgedwongen: een veld van de verkeerde lengte
// zou stilzwijgend een ander commitment opleveren dat nergens op opent.
export function berekenCommitment({ method, asset, authorizer, identifier, salt }) {
  if (!method) throw new Error('method ontbreekt')
  if (!kentMethode(method)) throw new Error(`onbekende authorizationMethod: ${method}`)
  const lengtes = LENGTES[method]

  const pre = Buffer.concat([
    TAG, NUL,
    Buffer.from(method, 'ascii'), NUL,
    bytes(asset, 'asset', lengtes.asset),
    bytes(authorizer, 'authorizer', lengtes.authorizer),
    bytes(identifier, 'identifier', 32),
    bytes(salt, 'salt', 32),
  ])
  return '0x' + createHash('sha256').update(pre).digest('hex')
}

// §5.6.4 stap 1: de authorizer komt uit het ONDERTEKENDE payer-veld van het bonnetje,
// nooit uit een waarde die naast het zout wordt aangeleverd. Anders kan iemand een
// commitment laten openen op een afrekening van een ander.
export function opentCommitment({ receipt, salt, asset, kandidaatIdentifiers }) {
  const payload = receipt?.payload ?? receipt
  const method = payload?.authorizationMethod
  const commitment = payload?.authorizationCommitment
  if (!method || !commitment) return { linked: false, reden: 'receipt carries no commitment' }

  // De vaste velden EERST, buiten de lus. Anders kan een onbruikbaar zout of een
  // onbekende methode nooit zichtbaar worden: elke ronde gooit dan dezelfde fout, de
  // catch slikt hem op, en de uitslag wordt "geen kandidaat opent dit" terwijl de
  // waarheid is dat er niets te berekenen viel. Dat is het verschil tussen een
  // afkeuring en een onvolledige meting, en dat verschil mag nooit wegvallen.
  if (!kentMethode(method)) {
    return { linked: false, meetbaar: false, reden: `unknown authorizationMethod: ${method}` }
  }
  try {
    berekenCommitment({ method, asset, authorizer: payload.payer, identifier: '0x' + '00'.repeat(32), salt })
  } catch (e) {
    return { linked: false, meetbaar: false, reden: 'cannot compute a commitment here: ' + e.message }
  }

  const treffers = []
  for (const identifier of kandidaatIdentifiers ?? []) {
    let berekend
    // Hier kan nog maar een ding misgaan: deze ene identifier heeft de verkeerde
    // lengte. Dat is dan geen treffer, en dat is de juiste uitkomst.
    try { berekend = berekenCommitment({ method, asset, authorizer: payload.payer, identifier, salt }) } catch { continue }
    if (berekend.toLowerCase() === String(commitment).toLowerCase()) treffers.push(identifier)
  }

  // §5.6.4 stap 3: precies een MOET matchen, anders linkt het bonnetje niet.
  // Bewust fail-closed: nul en twee zijn allebei "niet gelinkt", niet "waarschijnlijk".
  if (treffers.length === 1) return { linked: true, identifier: treffers[0] }
  if (treffers.length === 0) return { linked: false, reden: 'no candidate opens this commitment' }
  return { linked: false, reden: `${treffers.length} candidates open the same commitment, so it is ambiguous` }
}

// Het voorbeeld dat in hun eigen spec staat, met de verwachte uitkomst erbij.
// Het commit staat erbij omdat die PR nog open is: een tak beweegt, een commit niet.
// Zonder dat nummer zou deze vector stil kunnen verouderen zonder dat de test valt.
// Dit is de hele interop-toets voor deze kant: rekenen wij uit hun tekst hetzelfde
// getal uit als zij publiceren?
export const SPEC_VOORBEELD = {
  bron: 'x402-foundation/x402, specs/extensions/extension-offer-and-receipt.md §5.6.2, tak receipt-authorization-commitment op commit 0e492d6730bef14b9c722428386c114f3475a914',
  invoer: {
    method: 'eip3009',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    authorizer: '0x857b06519E91e3A54538791bDbb0E22373e36b66',
    identifier: '0x5135a00b531830a13a751f3c48944d7a5fdfde7a3b87f73493591cd77efdef4f',
    salt: '0x10d2ae5f0c8536e82d882bf3d2c31a663597e890ca6c3fede0d278fd2a78f655',
  },
  verwacht: '0x5d905bbf08a97e04ab551d276d8e94b1abaff7d0737324d360e983c2796af23b',
}
