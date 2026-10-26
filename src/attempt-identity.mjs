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
import { canonicalMembers } from './canonical-request.mjs'

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
      'MUST be derived once, at ingress, from a single immutable snapshot of the request as received by the ' +
      'facilitator, and MUST NOT be re-derived or partially re-derived downstream',
  },
  {
    id: 'ingress-snapshot-complete',
    citaat:
      'The ingress snapshot ... MUST contain at least the decoded method, path, the canonical query, the decoded body ' +
      '(or a digest of it computed after decoding), and the resolved payTo, asset, network, amount, and scheme',
  },
  {
    id: 'all-paths-same-artifact',
    citaat:
      '/settle, refusal handling, replay-lookup, and challenge-quote responses all resolve the same artifact value. ' +
      'None of them re-reads the request or recomputes the digest from request content that was not part of the ingress snapshot',
  },
  {
    id: 'changed-request-different-artifact',
    citaat:
      'A request whose amount, query, or body differs MUST produce a different artifact, established at ingress by ' +
      'comparing snapshots, not discovered later by comparing two downstream resolutions',
  },
  {
    id: 'own-identity-from-decoded-fields',
    citaat:
      'Identity MUST be derived over these named decoded fields, and MUST NOT be derived over the transmitted bytes of ' +
      'the request or any encoding that varies between representations of the same request',
  },
  {
    id: 'normalization-applied',
    citaat:
      'Normalization MUST be applied to each of these members as specified: network in CAIP-2 canonical form, EVM ' +
      'addresses lowercased, timestamps in RFC 3339 Z form, version as decoded, and URLs not normalized',
  },
  {
    id: 'canonical-members',
    citaat:
      'the members entering the hash are canonicalized before hashing, never hashed as transmitted: query parsed to ' +
      'sorted, uppercase-hex percent-encoded pairs; body decoded (content-encoding, then charset); SHA-256, with RFC 8785 ' +
      'for JSON bodies',
  },
  {
    id: 'absent-member-omitted',
    citaat:
      'An absent member MUST be omitted from the hashed set entirely and MUST NOT be emitted as null, empty string, or zero',
  },
  {
    id: 'countersignature-recompute-or-refuse',
    citaat:
      'that counterparty MUST independently recompute the fingerprint from the bytes it observed, and MUST refuse to sign ' +
      'if the recomputed value differs ... Where the counterparty cannot perform the recomputation it MUST NOT sign either, ' +
      'and MUST report which of the two it is: refused because the values differ, or refused because the comparison could ' +
      'not be made',
  },
  {
    id: 'three-identifiers-not-collapsed',
    citaat:
      'Three identifiers are therefore in play, and an implementation MUST NOT collapse them: operation identity, ' +
      'captured-artifact digest, signed-content identifier. A format MUST declare which of these its reference covers',
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
      if (p.established_at === undefined) return niet(`niet vastgelegd waar het verschil van pad ${p.path} werd vastgesteld`)
      // De tekst: vastgesteld OP DE INGANG door momentopnames te vergelijken, niet later ontdekt door twee afleidingen
      // downstream te vergelijken. Een gebeurtenis die zo'n afwijking meldt is geen toegestane werkwijze maar bewijs van de overtreding.
      if (p.established_at !== 'ingress') {
        return faal('DIVERGENCE_DISCOVERED_DOWNSTREAM', `pad ${p.path}: het verschil werd pas ${p.established_at} ontdekt, niet op de ingang`)
      }
    }
    return goed(`${gewijzigd.length} gewijzigd(e) verzoek(en), elk met eigen identiteit en op de ingang vastgesteld`)
  }


  if (id === 'countersignature-recompute-or-refuse') {
    const c = inv.countersignature
    if (!c) return niet('geen medeondertekening vastgelegd')
    // Kan de tegenpartij niet vergelijken (bytes nooit waargenomen, of een lid dat de vergelijking leest ontbreekt),
    // dan MOET zij ook niet tekenen en MOET zij melden WELKE van de twee het is. Afwezigheid is geen verschil.
    if (c.comparable === false) {
      if (c.signed === true) return faal('SIGNED_WITHOUT_COMPARISON', 'de vergelijking kon niet worden gemaakt en er is toch ondertekend')
      if (c.settled === true) return faal('SETTLED_WITHOUT_COMPARISON', 'de vergelijking kon niet worden gemaakt en er is toch afgerekend')
      if (c.reported_reason === undefined) return niet('niet vastgelegd welke reden is gemeld')
      if (c.reported_reason !== 'comparison_not_possible') {
        return faal('REFUSAL_REASONS_COLLAPSED', `de weigering omdat de vergelijking niet kon worden gemaakt is gemeld als ${c.reported_reason}`)
      }
      return goed('geweigerd, niet ondertekend, en gemeld dat de vergelijking niet kon worden gemaakt')
    }
    if (c.recomputed === undefined || c.ingress_value === undefined) return niet('geen herberekende of ingress-waarde')
    const past = zelfde(c.recomputed, c.ingress_value)
    if (!past && c.signed === true) return faal('COUNTERSIGNED_DESPITE_MISMATCH', 'de herberekende waarde week af en er is toch ondertekend')
    if (!past && c.settled === true) return faal('SETTLED_DESPITE_MISMATCH', 'de herberekende waarde week af en er is toch afgerekend')
    if (!past && c.reported_reason !== undefined && c.reported_reason !== 'values_differ') {
      return faal('REFUSAL_REASONS_COLLAPSED', `de weigering omdat de waarden verschillen is gemeld als ${c.reported_reason}`)
    }
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

  if (id === 'ingress-snapshot-complete') {
    const snap = inv.ingress?.snapshot
    if (!snap) return niet('geen ingress-momentopname vastgelegd')
    const VERPLICHT = ['method', 'path', 'query', 'body', 'payTo', 'asset', 'network', 'amount', 'scheme']
    const ontbreekt = VERPLICHT.filter((k) => !(k in snap))
    if (ontbreekt.length) return faal('INGRESS_SNAPSHOT_INCOMPLETE', `de momentopname mist: ${ontbreekt.join(', ')}`)
    return goed('alle negen verplichte leden staan in de momentopname')
  }

  if (id === 'normalization-applied') {
    const v = inv.normalization_variants
    if (!Array.isArray(v) || v.length < 2) return niet('minder dan twee varianten vastgelegd')
    const norm = (r) => ({
      network: /^[a-z0-9-]{3,8}:[A-Za-z0-9_-]{1,32}$/.test(String(r.network ?? '')) ? r.network : null,
      address: typeof r.address === 'string' ? r.address.toLowerCase() : null,
      timestamp: Number.isNaN(Date.parse(r.timestamp)) ? null : new Date(r.timestamp).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    })
    const genormaliseerd = v.map((x) => ({ n: norm(x.raw), id: kaal(x.identity) }))
    if (genormaliseerd.some((x) => x.n.network === null)) return niet('een netwerk staat niet in CAIP-2-vorm, dus er valt niets te normaliseren')
    const sleutels = genormaliseerd.map((x) => velddigest(x.n))
    const sets = new Set(sleutels)
    const ids = genormaliseerd.map((x) => x.id)
    if (sets.size === 1 && new Set(ids).size !== 1) {
      return faal('NORMALIZATION_NOT_APPLIED', 'dezelfde leden na normalisatie, maar de identiteiten verschillen')
    }
    if (sets.size > 1) {
      const per = new Map()
      sleutels.forEach((k, i) => { if (per.has(k) && per.get(k) !== ids[i]) return; per.set(k, ids[i]) })
      const gebruikt = [...per.values()]
      if (new Set(gebruikt).size !== gebruikt.length) return faal('DIFFERENT_REQUEST_SAME_IDENTITY', 'verschillende genormaliseerde leden kregen dezelfde identiteit')
    }
    return goed(`${v.length} varianten, identiteit volgt de genormaliseerde leden`)
  }

  if (id === 'canonical-members') {
    const v = inv.canonical_variants
    if (!Array.isArray(v) || v.length < 2) return niet('minder dan twee draadvarianten vastgelegd')
    let leden
    try { leden = v.map((x) => ({ k: velddigest(canonicalMembers(x.raw)), id: kaal(x.identity) })) } catch (e) { return niet('een draadvariant kon niet worden gedecodeerd: ' + e.message) }
    const perCanoniek = new Map()
    for (const l of leden) { const s2 = perCanoniek.get(l.k) ?? new Set(); s2.add(l.id); perCanoniek.set(l.k, s2) }
    for (const s2 of perCanoniek.values()) if (s2.size > 1) return faal('IDENTITY_OVER_NON_CANONICAL_FORM', 'dezelfde canonieke leden kregen een andere identiteit, dus de identiteit is over de verzonden vorm genomen')
    const identiteiten = [...perCanoniek.values()].map((s2) => [...s2][0])
    if (new Set(identiteiten).size !== identiteiten.length) return faal('DIFFERENT_REQUEST_SAME_IDENTITY', 'verschillende canonieke leden kregen dezelfde identiteit')
    return goed(`${v.length} draadvarianten, ${perCanoniek.size} canonieke vorm(en), identiteit volgt de canonieke leden`)
  }

  if (id === 'absent-member-omitted') {
    const h = inv.hashed_set
    if (!h || !h.members || !Array.isArray(h.absent)) return niet('geen gehashte verzameling met afwezige leden vastgelegd')
    for (const naam of h.absent) {
      if (naam in h.members) {
        const w = h.members[naam]
        if (w === null || w === '' || w === 0) return faal('ABSENT_MEMBER_EMITTED_AS_EMPTY', `het afwezige lid ${naam} staat in de verzameling als ${JSON.stringify(w)}`)
        return niet(`het lid ${naam} is als afwezig opgegeven maar heeft een waarde`)
      }
    }
    return goed(`${h.absent.length} afwezige leden, geen enkel in de gehashte verzameling`)
  }

  if (id === 'three-identifiers-not-collapsed') {
    const r = inv.signed_artifact_reference
    if (!r || !Array.isArray(r.variants) || r.variants.length === 0) return niet('geen verwijzing naar een ondertekend stuk vastgelegd')
    if (!r.declared) return faal('REFERENCE_NOT_DECLARED', 'het formaat verklaart niet welke van de drie identificatoren zijn verwijzing dekt')
    for (const x of r.variants) {
      const overBytes = bytedigest(x.transmitted)
      let overVelden = null
      try { overVelden = velddigest(JSON.parse(x.transmitted)) } catch { overVelden = null }
      if (r.scheme_signs === 'bytes') {
        if (zelfde(x.reference_hash, overBytes)) continue
        if (overVelden && zelfde(x.reference_hash, overVelden)) return faal('REFERENCE_CANONICALIZED_BEFORE_HASHING', 'een schema dat bytes ondertekent kreeg een verwijzing over een gecanonicaliseerde vorm, dus over een ander object dan er ondertekend is')
        return faal('REFERENCE_HASH_UNEXPLAINED', 'de verwijzing komt met geen van beide kandidaten overeen')
      }
      if (r.scheme_signs === 'typed-fields') {
        if (overVelden && zelfde(x.reference_hash, overVelden)) continue
        if (zelfde(x.reference_hash, overBytes)) return faal('REFERENCE_OVER_WIRE_ENVELOPE', 'een schema dat getypeerde velden ondertekent kreeg een verwijzing over de verzonden envelop, dus over een ander object dan er ondertekend is')
        return faal('REFERENCE_HASH_UNEXPLAINED', 'de verwijzing komt met geen van beide kandidaten overeen')
      }
      return niet('het schema ondertekent noch bytes noch getypeerde velden volgens de vector')
    }
    if (r.scheme_signs === 'typed-fields') {
      const refs = new Set(r.variants.map((x) => kaal(x.reference_hash)))
      if (r.variants.length >= 2 && refs.size !== 1) return faal('SIGNED_CONTENT_IDENTIFIER_UNSTABLE', 'twee serialisaties van dezelfde ondertekende inhoud gaven een andere verwijzing')
    }
    return goed(`de verwijzing dekt wat het schema ondertekent (${r.scheme_signs}) en het formaat verklaart het`)
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
