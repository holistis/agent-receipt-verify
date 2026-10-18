// Toetst de poging-identiteit: hoort dit alles bij DEZELFDE poging.
//
// WAAROM DIT BESTAAT. In erc-8004#99 kwamen op 18 oktober 2026 vier bewijslagen op tafel
// (vooraf-veiligheid, vooraf-oordeel, betaalbewijs na afrekening, en onafhankelijke
// werk-acceptatie), en de schrijver van de spec stelde vast dat geen van die vier de
// vraag eronder beantwoordt: welke van deze bewijsstukken gaan eigenlijk over dezelfde
// POGING. Hij schrijft die regel in x402#3776 paragraaf 5.5, en die paragraaf sluit af
// met een verwijzing naar "the normative conformance tests ... for the required negative
// cases". Die testen bestonden nog niet. Dit is dat.
//
// WAT HIER GEMETEN WORDT, en het is bewust alleen de INVARIANT. Niet of een facilitator
// goed rekent, niet of een handtekening klopt, maar of alle paden van een verzoek
// dezelfde identiteit opleveren en of een veranderd verzoek een andere identiteit krijgt.
// Dat is precies wat 5.5 eist en niets meer.
//
// WAT HIER MET OPZET NIET GEMETEN WORDT. Wij halen geen enkel pad zelf op. Een vector is
// een vastgelegde reeks WAARNEMINGEN per pad, en deze module toetst de invariant over die
// reeks. Een facilitator laten sonderen zou betekenen dat wij zijn betaalpaden aanroepen,
// en dat is niet aan ons.
//
// DRIE UITKOMSTEN, NOOIT TWEE: PASS, FAIL, NOT_MEASURED. Een clausule waarover de vector
// geen gegevens draagt is niet geslaagd en niet gefaald, hij is niet gemeten. Dat
// onderscheid is dezelfde correctie die de Kanon-auteur op 17 oktober 2026 overnam voor
// zijn eigen controleur, en de spec-auteur een dag later voor de zijne.

import { createHash } from 'node:crypto'

/**
 * De normatieve clausules van paragraaf 5.5, met het letterlijke citaat erbij.
 *
 * Het citaat staat hier zodat een lezer kan nazien dat wij toetsen wat er STAAT en niet
 * wat wij ervan maakten. Verandert de tekst, dan hoort dit mee te veranderen en is het
 * verschil zichtbaar in de diff in plaats van verstopt in een oordeel.
 */
export const CLAUSULES = [
  {
    id: 'derive-once-at-ingress',
    citaat:
      'MUST be derived once, at ingress, from the complete request snapshot as received by the facilitator, ' +
      'and MUST NOT be re-derived or partially re-derived downstream',
  },
  {
    id: 'all-paths-same-artifact',
    citaat:
      '/settle, refusal handling, replay-lookup, and challenge-quote responses all resolve the same artifact value',
  },
  {
    id: 'changed-request-different-artifact',
    citaat:
      'A request whose amount, query, or body changes between paths MUST produce a different artifact, and that ' +
      'change MUST surface as a settlement or announcement event, never as a silent divergence',
  },
  {
    id: 'countersignature-recompute-or-refuse',
    citaat:
      'that counterparty MUST independently recompute the fingerprint from the bytes it observed, and MUST refuse ' +
      'to sign if the recomputed value differs ... on mismatch the interaction MUST NOT settle',
  },
  {
    id: 'own-identity-from-decoded-fields',
    citaat:
      "an attempt's own identity ... MUST be derived from named decoded fields and MUST NOT be derived from wire " +
      'bytes, an attempt is the same attempt whether it arrived with a different key order or different whitespace',
  },
  {
    id: 'reference-over-transmitted-bytes',
    citaat:
      'that reference is taken over the artifact as transmitted, because the signature covers those bytes, ' +
      'canonicalizing them first would verify a different object than the one that was signed',
  },
  {
    id: 'outcome-not-folded-into-identity',
    citaat:
      'Outcome payloads produced later in the attempt ... are not folded into the identity artifact, an ' +
      'implementation MUST NOT extend identity derivation with values that did not exist at ingress',
  },
  {
    id: 'name-independent-but-bound',
    citaat:
      'An implementation that already uses Idempotency-Key satisfies it by binding that key to the ingress snapshot',
  },
]

export const UITKOMSTEN = ['PASS', 'FAIL', 'NOT_MEASURED']

// Een minimale canonicalisatie: sleutels gesorteerd, geen witruimte. Genoeg om "dezelfde
// velden, andere sleutelvolgorde" te herkennen, en met opzet NIET uitgegeven als een
// volledige RFC8785-implementatie: die heeft eigen regels voor getallen, en een halve
// implementatie onder een bekende naam is erger dan een eigen kleine functie onder een
// eigen naam.
export function sorteerStabiel(w) {
  if (Array.isArray(w)) return w.map(sorteerStabiel)
  if (w && typeof w === 'object') {
    const uit = {}
    for (const k of Object.keys(w).sort()) uit[k] = sorteerStabiel(w[k])
    return uit
  }
  return w
}

export const velddigest = (o) => createHash('sha256').update(JSON.stringify(sorteerStabiel(o))).digest('hex')
export const bytedigest = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')

const kaal = (w) => (typeof w === 'string' ? w.trim().toLowerCase().replace(/^0x/, '') : null)
const zelfde = (a, b) => kaal(a) !== null && kaal(a) === kaal(b)

const PAD_NAMEN = ['challenge-quote', 'settle', 'refusal', 'replay-lookup']

/** Eén clausule, één oordeel. Geen gegevens betekent NOT_MEASURED en nooit FAIL. */
function toetsClausule(id, inv) {
  const niet = (reden) => ({ clausule: id, uitkomst: 'NOT_MEASURED', reden })
  const faal = (code, detail) => ({ clausule: id, uitkomst: 'FAIL', reason_code: code, detail })
  const goed = (detail) => ({ clausule: id, uitkomst: 'PASS', detail })

  if (id === 'derive-once-at-ingress') {
    const ingress = inv.ingress
    const paden = Array.isArray(inv.paths) ? inv.paths : []
    if (!ingress?.identity || paden.length === 0) return niet('geen ingress-identiteit of geen paden vastgelegd')
    // Een pad dat de identiteit opnieuw afleidt uit iets dat NIET in de ingress-momentopname
    // zat, is de overtreding. De vector legt dat vast als het veld `derived_from`.
    for (const p of paden) {
      if (p.derived_from && p.derived_from !== 'ingress-snapshot') {
        return faal('IDENTITY_REDERIVED_DOWNSTREAM', `pad ${p.path} leidde opnieuw af uit ${p.derived_from}`)
      }
    }
    return goed(`${paden.length} paden, allemaal uit de ingress-momentopname`)
  }

  if (id === 'all-paths-same-artifact') {
    const paden = Array.isArray(inv.paths) ? inv.paths : []
    const metSnapshot = paden.filter((p) => p.identity)
    if (metSnapshot.length < 2) return niet('minder dan twee paden met een identiteit')
    // Alleen paden met EEN GELIJK verzoek horen dezelfde identiteit te hebben. Een pad
    // met een gewijzigd verzoek valt onder de volgende clausule, niet onder deze.
    const basis = inv.ingress?.snapshot ? velddigest(inv.ingress.snapshot) : null
    const gelijkVerzoek = metSnapshot.filter((p) => !p.snapshot || !basis || velddigest(p.snapshot) === basis)
    if (gelijkVerzoek.length < 2) return niet('minder dan twee paden met een ongewijzigd verzoek')
    const eerste = gelijkVerzoek[0]
    for (const p of gelijkVerzoek.slice(1)) {
      if (!zelfde(p.identity, eerste.identity)) {
        return faal('PATHS_DISAGREE_ON_IDENTITY', `${eerste.path} en ${p.path} geven een andere identiteit`)
      }
    }
    const gedekt = gelijkVerzoek.map((p) => p.path).filter((p) => PAD_NAMEN.includes(p))
    return goed(`${gelijkVerzoek.length} paden eens, waarvan benoemd in de spec: ${gedekt.join(', ') || 'geen'}`)
  }

  if (id === 'changed-request-different-artifact') {
    const paden = Array.isArray(inv.paths) ? inv.paths : []
    const basis = inv.ingress?.snapshot
    if (!basis) return niet('geen ingress-momentopname om tegen af te zetten')
    const gewijzigd = paden.filter((p) => p.snapshot && velddigest(p.snapshot) !== velddigest(basis))
    if (gewijzigd.length === 0) return niet('geen pad met een gewijzigd verzoek vastgelegd')
    for (const p of gewijzigd) {
      if (zelfde(p.identity, inv.ingress.identity)) {
        return faal('CHANGED_REQUEST_SAME_IDENTITY', `pad ${p.path} wijzigde het verzoek en hield dezelfde identiteit`)
      }
      const events = Array.isArray(inv.events) ? inv.events : []
      const erkend = events.some((e) => zelfde(e.identity, p.identity))
      if (!erkend) {
        return faal('CHANGED_REQUEST_NO_EVENT', `pad ${p.path} kreeg een andere identiteit zonder dat er een gebeurtenis bij hoort`)
      }
    }
    return goed(`${gewijzigd.length} gewijzigd(e) verzoek(en), elk met eigen identiteit en een gebeurtenis`)
  }

  if (id === 'countersignature-recompute-or-refuse') {
    const c = inv.countersignature
    if (!c) return niet('geen medeondertekening vastgelegd')
    if (c.recomputed === undefined || c.ingress_value === undefined) return niet('geen herberekende of ingress-waarde')
    const past = zelfde(c.recomputed, c.ingress_value)
    if (!past && c.signed === true) return faal('COUNTERSIGNED_DESPITE_MISMATCH', 'de herberekende waarde week af en er is toch ondertekend')
    if (!past && c.settled === true) return faal('SETTLED_DESPITE_MISMATCH', 'de herberekende waarde week af en er is toch afgerekend')
    if (past && c.signed === false) return goed('de waarden kloppen en er is niet ondertekend, dat is toegestaan maar ongebruikelijk')
    return goed(past ? 'herberekend en gelijk, dus ondertekenen mag' : 'herberekend en afwijkend, dus geweigerd en niet afgerekend')
  }

  if (id === 'own-identity-from-decoded-fields') {
    const v = inv.wire_variants
    if (!Array.isArray(v) || v.length < 2) return niet('minder dan twee draadvarianten vastgelegd')
    // Dezelfde velden, andere sleutelvolgorde of witruimte. De identiteit MOET gelijk
    // blijven; verschilt hij, dan is hij uit de bytes afgeleid.
    const digests = new Set(v.map((x) => velddigest(x.decoded)))
    if (digests.size !== 1) return niet('de varianten hebben niet dezelfde gedecodeerde velden')
    const ids = new Set(v.map((x) => kaal(x.identity)))
    if (ids.size !== 1) {
      return faal('IDENTITY_DERIVED_FROM_WIRE_BYTES', 'dezelfde velden in een andere sleutelvolgorde gaven een andere identiteit')
    }
    return goed(`${v.length} draadvarianten, dezelfde identiteit`)
  }

  if (id === 'reference-over-transmitted-bytes') {
    const r = inv.signed_artifact_reference
    if (!r || r.transmitted === undefined || r.reference_hash === undefined) return niet('geen verwijzing naar een ondertekend stuk')
    // Wij rekenen beide kanten ZELF uit in plaats van een label te geloven.
    const overBytes = bytedigest(r.transmitted)
    let overVelden = null
    try {
      overVelden = velddigest(JSON.parse(r.transmitted))
    } catch {
      overVelden = null
    }
    if (zelfde(r.reference_hash, overBytes)) return goed('de verwijzing is over de verzonden bytes genomen')
    if (overVelden && zelfde(r.reference_hash, overVelden)) {
      return faal('REFERENCE_CANONICALIZED_BEFORE_HASHING', 'de verwijzing is over een gecanonicaliseerde vorm genomen, dus over een ander object dan er ondertekend is')
    }
    return faal('REFERENCE_HASH_UNEXPLAINED', 'de verwijzing komt noch met de verzonden bytes noch met een gecanonicaliseerde vorm overeen')
  }

  if (id === 'outcome-not-folded-into-identity') {
    const o = inv.outcome_variants
    if (!Array.isArray(o) || o.length < 2) return niet('minder dan twee uitkomst-varianten vastgelegd')
    const ids = new Set(o.map((x) => kaal(x.identity)))
    if (ids.size !== 1) {
      return faal('OUTCOME_FOLDED_INTO_IDENTITY', 'de identiteit verschilt tussen volledige en gedeeltelijke levering, dus uitkomstdata zit erin')
    }
    return goed(`${o.length} leveringsvarianten, dezelfde identiteit`)
  }

  if (id === 'name-independent-but-bound') {
    const k = inv.identity_field
    if (!k || k.bound_to === undefined) return niet('geen identiteitsveld met een binding vastgelegd')
    if (k.bound_to !== 'ingress-snapshot') {
      return faal('IDENTITY_NOT_BOUND_TO_SNAPSHOT', `het veld ${k.name ?? 'onbekend'} is gebonden aan ${k.bound_to} in plaats van aan de ingress-momentopname`)
    }
    if (k.client_supplied === true && k.verified_against_snapshot !== true) {
      return faal('CLIENT_SUPPLIED_IDENTITY_NOT_VERIFIED', 'de client levert de identiteit aan en die wordt niet tegen de momentopname getoetst')
    }
    return goed(`${k.name ?? 'het identiteitsveld'} is aan de ingress-momentopname gebonden`)
  }

  return niet('onbekende clausule')
}

/**
 * Toetst alle clausules waarover de vector gegevens draagt.
 *
 * Het eindoordeel is FAIL zodra EEN clausule faalt, want 5.5 is een invariant en niet een
 * cijferlijst. Zonder enige meetbare clausule is het NOT_MEASURED, nooit PASS: een vector
 * zonder gegevens mag nooit als bewijs van naleving tellen.
 */
export function toetsPogingIdentiteit(invoer) {
  const inv = invoer && typeof invoer === 'object' ? invoer : {}
  const perClausule = CLAUSULES.map((c) => toetsClausule(c.id, inv))
  const gefaald = perClausule.filter((r) => r.uitkomst === 'FAIL')
  const geslaagd = perClausule.filter((r) => r.uitkomst === 'PASS')
  const uitkomst = gefaald.length > 0 ? 'FAIL' : geslaagd.length > 0 ? 'PASS' : 'NOT_MEASURED'
  return {
    outcome: uitkomst,
    reason_code: gefaald[0]?.reason_code ?? null,
    detail: gefaald[0]?.detail ?? null,
    gemeten: geslaagd.length + gefaald.length,
    niet_gemeten: perClausule.length - geslaagd.length - gefaald.length,
    per_clausule: perClausule,
  }
}

// Een ingang, zodat dit geen bestand is dat iemand moet vinden maar een regel die hij kan
// draaien. Zonder sleutel, zonder account, zonder netwerk.
if (process.argv[1]?.endsWith('attempt-identity.mjs')) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const map = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'attempt-identity')
  const bestanden = fs.readdirSync(map).filter((b) => b.endsWith('.json')).sort()
  let past = 0
  for (const b of bestanden) {
    const v = JSON.parse(fs.readFileSync(path.join(map, b), 'utf8'))
    const u = toetsPogingIdentiteit(v.input)
    const ok = u.outcome === v.expected.outcome && (v.expected.reason_code === undefined || u.reason_code === v.expected.reason_code)
    if (ok) past++
    console.log((ok ? '  ok   ' : '  FAIL ') + b.replace('.json', '').padEnd(40) + u.outcome + (u.reason_code ? ' / ' + u.reason_code : ''))
  }
  console.log('')
  console.log(past + ' of ' + bestanden.length + ' vectors behave as recorded, across ' + CLAUSULES.length + ' normative clauses of x402 spec section 5.5.')
  console.log('Every clause carries one acceptance and at least one refusal. No account, no key, no network.')
  if (past !== bestanden.length) process.exitCode = 1
}
