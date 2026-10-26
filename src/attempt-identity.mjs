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
import { canonicalMembers, canonicalQuery, bodyDigest } from './canonical-request.mjs'

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
    const uit = Object.create(null)
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
    // Een pad dat de identiteit opnieuw afleidt uit iets dat NIET in de ingress-momentopname zat, is de overtreding.
    // Het veld `derived_from` legt dat vast; ontbreekt het, dan is er niets gemeten en is het nooit een goedkeuring.
    for (const p of paden) {
      if (p.derived_from && p.derived_from !== 'ingress-snapshot') {
        return faal('IDENTITY_REDERIVED_DOWNSTREAM', `pad ${p.path} leidde opnieuw af uit ${p.derived_from}`)
      }
    }
    const zonder = paden.filter((p) => !p.derived_from).map((p) => p.path)
    if (zonder.length) return niet(`niet vastgelegd waaruit pad ${zonder.join(', ')} afleidde`)
    return goed(`${paden.length} paden, allemaal uit de ingress-momentopname`)
  }


  if (id === 'all-paths-same-artifact') {
    const paden = Array.isArray(inv.paths) ? inv.paths : []
    const metIdentiteit = paden.filter((p) => p.identity)
    const basis = inv.ingress?.snapshot ? velddigest(inv.ingress.snapshot) : null
    // Alleen paden met EEN GELIJK verzoek horen dezelfde identiteit te hebben; een gewijzigd verzoek valt onder een andere clausule.
    const gelijkVerzoek = metIdentiteit.filter((p) => !p.snapshot || !basis || velddigest(p.snapshot) === basis)
    const referentie = inv.ingress?.identity ?? gelijkVerzoek[0]?.identity
    if (gelijkVerzoek.length < 2 && !(inv.ingress?.identity && gelijkVerzoek.length >= 1)) return niet('minder dan twee paden met een ongewijzigd verzoek')
    for (const p of gelijkVerzoek) {
      if (!zelfde(p.identity, referentie)) {
        return faal('PATHS_DISAGREE_ON_IDENTITY', `pad ${p.path} geeft een andere identiteit dan ${inv.ingress?.identity ? 'de ingress' : gelijkVerzoek[0].path}`)
      }
    }
    const gedekt = gelijkVerzoek.map((p) => p.path).filter((p) => PAD_NAMEN.includes(p))
    return goed(`${gelijkVerzoek.length} paden eens met ${inv.ingress?.identity ? 'de ingress' : 'elkaar'}, waarvan benoemd in de spec: ${gedekt.join(', ') || 'geen'}`)
  }


  if (id === 'changed-request-different-artifact') {
    const paden = Array.isArray(inv.paths) ? inv.paths : []
    const basis = inv.ingress?.snapshot
    if (!basis) return niet('geen ingress-momentopname om tegen af te zetten')
    const gewijzigd = paden.filter((p) => p.snapshot && velddigest(p.snapshot) !== velddigest(basis))
    if (gewijzigd.length === 0) return niet('geen pad met een gewijzigd verzoek vastgelegd')
    // Eerst ALLE paden op een samengevouwen identiteit: een vroege NOT_MEASURED mag een overtreding niet verbergen.
    for (const p of gewijzigd) {
      if (zelfde(p.identity, inv.ingress.identity)) {
        return faal('CHANGED_REQUEST_SAME_IDENTITY', `pad ${p.path} wijzigde het verzoek en hield dezelfde identiteit`)
      }
    }
    for (const p of gewijzigd) {
      // De tekst: vastgesteld OP DE INGANG door momentopnames te vergelijken, niet later ontdekt door twee afleidingen
      // downstream te vergelijken. Een gebeurtenis die zo'n afwijking meldt is geen toegestane werkwijze maar bewijs van de overtreding.
      if (p.established_at !== undefined && p.established_at !== 'ingress') {
        return faal('DIVERGENCE_DISCOVERED_DOWNSTREAM', `pad ${p.path}: het verschil werd pas ${p.established_at} ontdekt, niet op de ingang`)
      }
    }
    const zonder = gewijzigd.filter((p) => p.established_at === undefined).map((p) => p.path)
    if (zonder.length) return niet(`niet vastgelegd waar het verschil van pad ${zonder.join(', ')} werd vastgesteld`)
    return goed(`${gewijzigd.length} gewijzigd(e) verzoek(en), elk met eigen identiteit en op de ingang vastgesteld`)
  }


  if (id === 'countersignature-recompute-or-refuse') {
    const c = inv.countersignature
    if (!c) return niet('geen medeondertekening vastgelegd')
    const kanNiet = c.comparable === false || (c.comparable === undefined && (c.recomputed === null || c.ingress_value === null))
    // Kan de tegenpartij niet vergelijken (bytes nooit waargenomen, of een lid dat de vergelijking leest ontbreekt), dan MOET
    // zij ook niet tekenen en MOET zij melden WELKE van de twee het is. Afwezigheid is geen verschil.
    if (kanNiet) {
      if (c.signed === true) return faal('SIGNED_WITHOUT_COMPARISON', 'de vergelijking kon niet worden gemaakt en er is toch ondertekend')
      if (c.signed === undefined) return niet('niet vastgelegd of er is ondertekend')
      if (c.reported_reason === undefined) return niet('niet vastgelegd welke reden is gemeld')
      if (c.reported_reason !== 'comparison_not_possible') {
        return faal('REFUSAL_REASONS_COLLAPSED', `de weigering omdat de vergelijking niet kon worden gemaakt is gemeld als ${c.reported_reason}`)
      }
      return goed('geweigerd, niet ondertekend, en gemeld dat de vergelijking niet kon worden gemaakt')
    }
    if (c.recomputed === undefined || c.ingress_value === undefined) return niet('geen herberekende of ingress-waarde')
    const past = zelfde(c.recomputed, c.ingress_value)
    if (!past) {
      if (c.signed === true) return faal('COUNTERSIGNED_DESPITE_MISMATCH', 'de herberekende waarde week af en er is toch ondertekend')
      if (c.settled === true) return faal('SETTLED_DESPITE_MISMATCH', 'de herberekende waarde week af en er is toch afgerekend')
      if (c.signed === undefined || c.settled === undefined) return niet('niet vastgelegd of er is ondertekend en afgerekend')
      if (c.reported_reason !== undefined && c.reported_reason !== 'values_differ') {
        return faal('REFUSAL_REASONS_COLLAPSED', `de weigering omdat de waarden verschillen is gemeld als ${c.reported_reason}`)
      }
      return goed('herberekend en afwijkend, dus geweigerd en niet afgerekend')
    }
    if (c.signed === false) return goed('de waarden kloppen en er is niet ondertekend, dat is toegestaan maar ongebruikelijk')
    return goed('herberekend en gelijk, dus ondertekenen mag')
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
    // Zeven leden moeten een waarde hebben; query en lichaam mogen leeg of afwezig zijn (een verzoek zonder query of zonder
    // lichaam bestaat), maar hun sleutel hoort in de momentopname te staan.
    const MOET_WAARDE = ['method', 'path', 'payTo', 'asset', 'network', 'amount', 'scheme']
    const MOET_STAAN = ['query', 'body']
    const leeg = (w) => w === undefined || w === null || w === ''
    const ontbreekt = [...MOET_WAARDE.filter((k) => leeg(snap[k])), ...MOET_STAAN.filter((k) => !(k in snap))]
    if (ontbreekt.length) return faal('INGRESS_SNAPSHOT_INCOMPLETE', `de momentopname mist: ${ontbreekt.join(', ')}`)
    return goed('alle negen verplichte leden staan in de momentopname')
  }


  if (id === 'normalization-applied') {
    const v = inv.normalization_variants
    if (!Array.isArray(v) || v.length < 2) return niet('minder dan twee varianten vastgelegd')
    const EVM = /^0x[0-9a-fA-F]{40}$/
    const tijd = (t) => {
      const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(String(t ?? ''))
      if (!m) return null
      const d = new Date(t)
      if (Number.isNaN(d.getTime())) return null
      const iso = d.toISOString()
      return m[2] ? iso : iso.replace(/\.000Z$/, 'Z')
    }
    const norm = (r) => ({ network: /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(String(r.network ?? '')) ? r.network : null, address: typeof r.address === 'string' ? (EVM.test(r.address) ? r.address.toLowerCase() : r.address) : null, timestamp: tijd(r.timestamp) })
    const rijen = v.map((x) => ({ n: norm(x.raw), id: kaal(x.identity) }))
    if (rijen.some((x) => x.n.network === null)) return niet('een netwerk staat niet in CAIP-2-vorm, dus er valt niets te normaliseren')
    if (rijen.some((x) => x.n.timestamp === null && x.n.address !== null && v.some((y) => y.raw.timestamp !== undefined))) return niet('een tijdstip is geen geldige RFC 3339-tijd')
    const perSleutel = new Map()
    for (const r of rijen) { const k = velddigest(r.n); const set = perSleutel.get(k) ?? new Set(); set.add(r.id); perSleutel.set(k, set) }
    for (const set of perSleutel.values()) {
      if (set.size > 1) return faal('NORMALIZATION_NOT_APPLIED', 'dezelfde leden na normalisatie, maar de identiteiten verschillen')
    }
    const ids = [...perSleutel.values()].map((set) => [...set][0])
    if (new Set(ids).size !== ids.length) return faal('DIFFERENT_REQUEST_SAME_IDENTITY', 'verschillende genormaliseerde leden kregen dezelfde identiteit')
    return goed(`${v.length} varianten, identiteit volgt de genormaliseerde leden`)
  }


  if (id === 'canonical-members') {
    const v = inv.canonical_variants
    const k = inv.known_answers
    if (!Array.isArray(v) && !Array.isArray(k)) return niet('geen draadvarianten en geen bekende antwoorden vastgelegd')
    let gemeten = 0
    if (Array.isArray(k) && k.length > 0) {
      // Bekende antwoorden: wat een implementatie voor de canonieke query en het lichaamsdigest teruggaf, tegenover wat de
      // tekst voorschrijft. Zo faalt een implementatie met kleine hex, een plus als spatie of een verkeerd tekenstelsel.
      for (const a of k) {
        let verwacht
        try { verwacht = { query: canonicalQuery(a.raw.query), body_sha256: a.raw.bodyBase64 !== undefined && a.raw.bodyBase64 !== '' ? bodyDigest(a.raw) : undefined } } catch (e) { return niet('een bekend antwoord kon niet worden berekend: ' + e.message) }
        for (const veld of ['query', 'body_sha256']) {
          if (a.observed?.[veld] === undefined) continue
          if (a.observed[veld] !== verwacht[veld]) return faal('CANONICAL_MEMBER_MISMATCH', `${veld}: de implementatie gaf ${JSON.stringify(a.observed[veld])}, de tekst geeft ${JSON.stringify(verwacht[veld])}`)
        }
        gemeten++
      }
    }
    if (Array.isArray(v) && v.length >= 2) {
      let leden
      try { leden = v.map((x) => ({ k: velddigest(canonicalMembers(x.raw)), id: kaal(x.identity) })) } catch (e) { return niet('een draadvariant kon niet worden gedecodeerd: ' + e.message) }
      const perCanoniek = new Map()
      for (const l of leden) { const s2 = perCanoniek.get(l.k) ?? new Set(); s2.add(l.id); perCanoniek.set(l.k, s2) }
      for (const s2 of perCanoniek.values()) if (s2.size > 1) return faal('IDENTITY_OVER_NON_CANONICAL_FORM', 'dezelfde canonieke leden kregen een andere identiteit, dus de identiteit is over de verzonden vorm genomen')
      const identiteiten = [...perCanoniek.values()].map((s2) => [...s2][0])
      if (new Set(identiteiten).size !== identiteiten.length) return faal('DIFFERENT_REQUEST_SAME_IDENTITY', 'verschillende canonieke leden kregen dezelfde identiteit')
      gemeten++
    }
    if (gemeten === 0) return niet('minder dan twee draadvarianten en geen bekende antwoorden')
    return goed('de canonieke leden en de identiteit volgen de tekst')
  }

  if (id === 'absent-member-omitted') {
    const h = inv.hashed_set
    if (!h || !h.members || !Array.isArray(h.absent)) return niet('geen gehashte verzameling met afwezige leden vastgelegd')
    // Alle afwezige leden eerst, zodat een lid met een waarde een lid met een lege waarde niet kan verbergen.
    for (const naam of h.absent) {
      if (naam in h.members) {
        const w = h.members[naam]
        if (w === null || w === '' || w === 0) return faal('ABSENT_MEMBER_EMITTED_AS_EMPTY', `het afwezige lid ${naam} staat in de verzameling als ${JSON.stringify(w)}`)
      }
    }
    const metWaarde = h.absent.filter((naam) => naam in h.members)
    if (metWaarde.length) return niet(`het lid ${metWaarde.join(', ')} is als afwezig opgegeven maar heeft een waarde`)
    return goed(`${h.absent.length} afwezige leden, geen enkel in de gehashte verzameling`)
  }


  if (id === 'three-identifiers-not-collapsed') {
    const r = inv.signed_artifact_reference
    if (!r || !Array.isArray(r.variants) || r.variants.length === 0) return niet('geen verwijzing naar een ondertekend stuk vastgelegd')
    const TOEGESTAAN = ['captured-artifact-digest', 'signed-content-identifier']
    if (!r.declared) return faal('REFERENCE_NOT_DECLARED', 'het formaat verklaart niet welke van de drie identificatoren zijn verwijzing dekt')
    if (!TOEGESTAAN.includes(r.declared)) return niet(`onbekende verklaring: ${r.declared}`)
    if (!r.input || !r.version) return faal('REFERENCE_INPUT_OR_VERSION_NOT_DECLARED', 'het formaat verklaart niet de invoer en de versie van die identificator')
    if (r.declared === 'captured-artifact-digest') {
      for (const x of r.variants) {
        const overBytes = bytedigest(x.transmitted)
        if (zelfde(x.reference_hash, overBytes)) continue
        let overVelden = null
        try { overVelden = velddigest(JSON.parse(x.transmitted)) } catch { overVelden = null }
        if (overVelden && zelfde(x.reference_hash, overVelden)) return faal('REFERENCE_CANONICALIZED_BEFORE_HASHING', 'een verwijzing over de verzonden bytes kreeg een gecanonicaliseerde vorm, dus een ander object dan er is vastgelegd')
        return faal('REFERENCE_HASH_UNEXPLAINED', 'de verwijzing komt met geen van beide kandidaten overeen')
      }
      return goed('de verwijzing is het digest van de verzonden bytes, en het formaat verklaart dat')
    }
    // signed-content-identifier: twee serialisaties van DEZELFDE ondertekende inhoud geven DEZELFDE verwijzing, en die is
    // niet het digest van de verzonden envelop. De receptuur zelf (bijvoorbeeld EIP-712) toetst deze controleur niet.
    if (r.variants.length < 2) return niet('minder dan twee serialisaties vastgelegd')
    let inhoud
    try { inhoud = new Set(r.variants.map((x) => velddigest(JSON.parse(x.transmitted)))) } catch { return niet('een serialisatie is geen JSON') }
    if (inhoud.size !== 1) return niet('de varianten hebben niet dezelfde ondertekende inhoud')
    for (const x of r.variants) {
      if (zelfde(x.reference_hash, bytedigest(x.transmitted))) return faal('REFERENCE_OVER_WIRE_ENVELOPE', 'een verwijzing naar de ondertekende inhoud is over de verzonden envelop genomen')
    }
    if (new Set(r.variants.map((x) => kaal(x.reference_hash))).size !== 1) return faal('SIGNED_CONTENT_IDENTIFIER_UNSTABLE', 'twee serialisaties van dezelfde ondertekende inhoud gaven een andere verwijzing')
    return goed('twee serialisaties van dezelfde inhoud, dezelfde verwijzing, en die is niet het digest van de envelop')
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
