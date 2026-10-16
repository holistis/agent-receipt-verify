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

const bytes = (h, naam, verwacht) => {
  const b = Buffer.from(String(h ?? '').replace(/^0x/, ''), 'hex')
  if (verwacht !== undefined && b.length !== verwacht) {
    throw new Error(`${naam} moet ${verwacht} bytes zijn, kreeg ${b.length}`)
  }
  return b
}

// §5.6.2. Elk veld na `method` heeft een vaste lengte, dus het voorbeeld is
// ondubbelzinnig. Lengtes worden hier afgedwongen: een veld van de verkeerde lengte
// zou stilzwijgend een ander commitment opleveren dat nergens op opent.
export function berekenCommitment({ method, asset, authorizer, identifier, salt }) {
  if (!method) throw new Error('method ontbreekt')
  const lengtes = { eip3009: { asset: 20, authorizer: 20 } }[method]
  if (!lengtes) throw new Error(`onbekende authorizationMethod: ${method}`)

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
  if (!method || !commitment) return { linked: false, reden: 'bonnetje heeft geen commitment' }

  const treffers = []
  for (const identifier of kandidaatIdentifiers ?? []) {
    let berekend
    try { berekend = berekenCommitment({ method, asset, authorizer: payload.payer, identifier, salt }) } catch { continue }
    if (berekend.toLowerCase() === String(commitment).toLowerCase()) treffers.push(identifier)
  }

  // §5.6.4 stap 3: precies een MOET matchen, anders linkt het bonnetje niet.
  // Bewust fail-closed: nul en twee zijn allebei "niet gelinkt", niet "waarschijnlijk".
  if (treffers.length === 1) return { linked: true, identifier: treffers[0] }
  if (treffers.length === 0) return { linked: false, reden: 'geen enkele kandidaat opent dit commitment' }
  return { linked: false, reden: `${treffers.length} kandidaten openen hetzelfde commitment, dus dubbelzinnig` }
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
