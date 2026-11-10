// Toetst een x402 Rejection Receipt: een briefje dat een verkoper teruggeeft bij een
// AFGEWEZEN betaalpoging, zodat koper en verkoper achteraf kunnen aantonen wat er
// gebeurde.
//
// WAAROM DIT BESTAAT. Op 10 november 2026 wees ruiruii (de auteur van x402#3776, sectie
// 5.5) erop dat een geweigerde herhaalde poging vandaag geen enkel spoor achterlaat: een
// koper die zegt "ik probeerde te betalen, het werd geweigerd" heeft niets om tegen te
// houden. Sectie 5.5 zelf gaat over iets anders (welke paden hetzelfde attempt_identity
// opleveren), niet over of een weigering wordt VASTGELEGD. Dit vult dat gat.
//
// DIT IS NOG GEEN X402-SPEC. Dit is ons EIGEN ontwerp, versie 1, na een eigen
// adversariële toets (zie vectors/rejection-receipt/README.md). De CLAUSULES hieronder
// citeren dus GEEN officiële spectekst, ze zijn ons eigen besluit, en dat staat er
// expliciet bij.
//
// WAT HIER WEL EN NIET BEWEZEN WORDT. Een handtekening bewijst dat de verkoper iets
// ONDERTEKENDE, niet dat het WAAR is. Daarom verplicht dit ontwerp een evidence_class per
// reden: alleen een reden die een derde zelf kan narekenen (CHAIN_VERIFIABLE /
// CLIENT_VERIFIABLE) mag als zodanig gelden; een reden die alleen de verkoper kan
// beweren (zoals een interne fraude-filter) moet ISSUER_ASSERTED heten. Een briefje dat
// een hogere klasse claimt dan de reden toelaat, is een AFKEURING, niet een waarschuwing.
//
// FASE 1, BEWUST SMAL. Dit pakket TEKENT NIETS. Elk bestaand bestand in dit repo
// (attempt-identity.mjs, x402-offer-receipt.mjs, verify-delivery.mjs,
// inam-countersigned.mjs) controleert alleen, niemand hier bewaart een eigen sleutel. Een
// bewaarde, permanente ondertekeningssleutel zonder een volwassen rotatieproces is een
// ander soort project (sleutelbeheer, uptime) naast een functie die nog niet bestaat, en
// dat hoort hier niet bij. Een partij die dit wil GEBRUIKEN tekent zelf.
//
// OOK BEWUST NIET HIER: de koper ondertekent in fase 1 geen eigen "Attempt Intent" vooraf.
// Zonder dat is een verzoek dat de koper nooit verstuurde in fase 1 niet te onderscheiden
// van een echt verzoek. Dat is een harde grens van deze versie, geen verborgen garantie.
// Ook niet hier: Witness-modus en een Merkle-transparantielog (fase 3, optioneel).
// INDEPENDENTLY_WITNESSED mag als waarde bestaan, maar geen enkele reden hieronder wijst
// er al naartoe, want niemand maakt die claim hier waar.

import { createHash } from 'node:crypto'
import { resolve as padResolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { jcs } from './canonical-request.mjs'
import { plekIsPubliek, MAX_DOCUMENT, HAAL_TIJDSLIMIET_MS, veiligVeld } from './verify-delivery.mjs'

/**
 * Onze eigen ontwerpregels, versie 1. GEEN citaat uit een officiële spec: dat bestaat nog
 * niet voor dit onderwerp. Elke regel noemt waarom hij er is, zodat een lezer die kan
 * narekenen in plaats van vertrouwen.
 */
export const CLAUSULES = [
  {
    id: 'decision-outcome-and-binding-present',
    citaat:
      'decision.outcome MOET REJECTED zijn, en attempt_binding MOET beide hashes dragen. Reden: zonder deze ' +
      'controle toetst de rest van deze module alleen HOE eerlijk een claim begrensd is, nooit WAT er geclaimd ' +
      'wordt; een briefje met outcome ACCEPTED of zonder enige binding kwam anders via een onbewaakte zijdeur ' +
      'alsnog op PASS uit (al-khasm, 10 nov 2026, zelf empirisch aangetoond, geen aanname).',
  },
  {
    id: 'dedicated-signing-key-not-payto',
    citaat:
      'De sleutel die een Rejection Receipt ondertekent MAG NIET gelijk zijn aan het payTo-adres van de ' +
      'verkoper. Reden: de bestaande x402 Offer-and-Receipt-extensie (specs/extensions/extension-offer-and-receipt.md ' +
      '§4.5.1) waarschuwt al dat het samenvoegen van de betaalsleutel en de ondertekeningssleutel het risico bij ' +
      'sleutelcompromittering vergroot, en onze eigen red-team-ronde (10 nov 2026) bevestigt dat een facilitator of ' +
      'wallet-sleutel hier niet geschikt is: alleen de resource server ziet het volledige, oorspronkelijke verzoek.',
  },
  {
    id: 'reason-code-bounded-fail-closed',
    citaat:
      'Een reason_code die niet in de vaste tabel staat, MOET sluiten als ISSUER_ASSERTED. Reden: een onbekende ' +
      'code met een hoger bewijsniveau zou een verkoper toelaten om zelf een nieuwe, niet-gecontroleerde reden te ' +
      'verzinnen en die meteen als "narekenbaar" te labelen.',
  },
  {
    id: 'evidence-class-not-overclaimed',
    citaat:
      'Het bewijsniveau dat een briefje claimt voor zijn reden, MAG NOOIT hoger zijn dan het niveau dat onze eigen, ' +
      'vaste tabel voor die reden toelaat. Reden: een handtekening bewijst alleen dat de verkoper iets beweerde, ' +
      'nooit dat de bewering waar is; dit is precies het "liegende briefje"-gat dat ons eigen red-team-onderzoek ' +
      '(10 nov 2026) als het eerste, zwaarste probleem benoemde.',
  },
  {
    id: 'payment-observation-vocabulary-bounded',
    citaat:
      'payment_observation.state MOET een van NOT_SUBMITTED, SETTLEMENT_PENDING, REJECTED of UNKNOWN zijn. Vrije ' +
      'tekst zoals "payment_failed" is een AFKEURING. Reden: x402 zelf behandelt settlement_pending al als een ' +
      'niet-terminale status (sectie 9, Error Handling); een plat "mislukt" verbergt precies dat onderscheid.',
  },
  {
    id: 'settlement-pending-not-presented-as-final',
    citaat:
      'Een briefje waarvan payment_observation.state SETTLEMENT_PENDING is, MAG decision.outcome niet gebruiken ' +
      'als een definitieve weigering zonder dat met zoveel woorden te markeren. Reden: een onzekere betaling kan ' +
      'later alsnog slagen; dit voorkomt dat een briefje zelf een onjuiste betalingsclaim wordt.',
  },
  {
    id: 'receipt-id-recomputes',
    citaat:
      'receipt_id MOET gelijk zijn aan de zelf herberekende digest over de kanonieke envelop zonder receipt_id en ' +
      'zonder signature. Reden: zonder deze herberekening kan de transportverpakking de identiteit van het bewijsstuk ' +
      'veranderen zonder dat een lezer dat ziet, hetzelfde gat dat sectie 5.5 voor attempt_identity al dichtte.',
  },
  {
    id: 'signature-verifies-against-resolved-key',
    citaat:
      'De handtekening MOET verifiëren tegen de sleutel die voor key_id wordt opgelost, niet tegen een sleutel die ' +
      'het briefje zelf meelevert. Reden: een verkoper die zijn eigen sleutel mag opgeven, kan anders elk briefje ' +
      'zelf geldig maken.',
  },
  {
    id: 'no-equivocation-for-same-binding',
    citaat:
      'Twee briefjes die naar dezelfde attempt-binding (payment_payload_hash + payment_requirements_hash) wijzen, ' +
      'mogen geen verschillende decision.outcome of reason_code hebben. Reden: dit is precies de tegenstrijdige-' +
      'briefjes-aanval die ons eigen red-team-onderzoek vond; detectie hiervan kost geen Merkle-log, alleen een ' +
      'vergelijking zodra een koper toevallig beide briefjes in handen krijgt.',
  },
]

export const UITKOMSTEN = ['PASS', 'FAIL', 'NOT_MEASURED']

export const PAYMENT_OBSERVATION_STATES = ['NOT_SUBMITTED', 'SETTLEMENT_PENDING', 'REJECTED', 'UNKNOWN']

export const EVIDENCE_CLASSES = ['ISSUER_ASSERTED', 'CLIENT_VERIFIABLE', 'CHAIN_VERIFIABLE', 'INDEPENDENTLY_WITNESSED']

/**
 * De vaste reden-tabel. Elke reden krijgt het HOOGSTE bewijsniveau dat eerlijk is: een
 * briefje mag dat niveau claimen of lager, nooit hoger.
 *
 * Herkomst: de tabel in het ChatGPT-ontwerp van 10 nov 2026, zelf nagelezen en
 * ingekort tot de gevallen die wij kunnen uitleggen. "risk_policy_rejected" en
 * "commercial_refusal" blijven ISSUER_ASSERTED: geen enkele derde kan een interne
 * risicobeslissing of een commerciële keuze onafhankelijk narekenen.
 */
export const REDEN_TABEL = new Map([
  ['invalid_signature', 'CLIENT_VERIFIABLE'],
  ['wrong_amount', 'CLIENT_VERIFIABLE'],
  ['wrong_recipient', 'CLIENT_VERIFIABLE'],
  ['invalid_exact_evm_payload_authorization_valid_before', 'CHAIN_VERIFIABLE'],
  ['invalid_exact_evm_payload_authorization_valid_after', 'CHAIN_VERIFIABLE'],
  ['insufficient_funds', 'CHAIN_VERIFIABLE'],
  ['duplicate_payment', 'CHAIN_VERIFIABLE'],
  ['facilitator_timeout', 'ISSUER_ASSERTED'],
  ['risk_policy_rejected', 'ISSUER_ASSERTED'],
  ['commercial_refusal', 'ISSUER_ASSERTED'],
])

const EVIDENCE_RANG = new Map(EVIDENCE_CLASSES.map((naam, i) => [naam, i]))

/** De envelop zoals die ondertekend wordt: alles behalve receipt_id en signature. */
export function kanoniekeEnvelop(receipt) {
  const { receipt_id, signature, ...rest } = receipt ?? {}
  return rest
}

/** sha256-hex over de RFC8785-kanonieke envelop. Dit IS de receipt_id-herberekening. */
export function berekenReceiptId(receipt) {
  return createHash('sha256').update(jcs(kanoniekeEnvelop(receipt)), 'utf8').digest('hex')
}

/**
 * De EIP-712-domeinscheiding, VERPLICHT en vast, niet "bijvoorbeeld". Gebonden aan
 * resource_origin, zodat elke verkoper onvermijdelijk zijn eigen domein heeft en een
 * handtekening niet voor een andere server kan worden hergebruikt. Dit is de reparatie
 * voor het "onderspecificeerd EIP-712-domein"-gat uit onze eigen red-team-ronde.
 */
export function eip712Domein(resourceOrigin) {
  return {
    name: 'x402-rejection-receipt',
    version: '1',
    salt: createHash('sha256').update(String(resourceOrigin ?? ''), 'utf8').digest(),
  }
}

export const EIP712_TYPES = {
  RejectionReceiptDigest: [{ name: 'digest', type: 'bytes32' }],
}

/** Het bytes32-veld dat werkelijk ondertekend wordt: de sha256 van de kanonieke envelop. */
export function handtekeningDigest(receipt) {
  return '0x' + createHash('sha256').update(jcs(kanoniekeEnvelop(receipt)), 'utf8').digest('hex')
}

let ethersModule
async function laadEthers() {
  if (ethersModule !== undefined) return ethersModule
  try {
    ethersModule = await import('ethers')
  } catch {
    ethersModule = null
  }
  return ethersModule
}

/**
 * Los key_id op via did:web, en geef het ECHTE antwoord terug naast het adres: een
 * koper die dit aanroept kan de ruwe resolutie meteen als eigen bewijsbundel bewaren.
 * Dat is de reparatie voor het sleutelrotatie-race-gat (did:web is zelf gewoon een
 * overschrijfbaar bestand, dus de koper moet NU bewaren, niet later opnieuw ophalen).
 *
 * key_id heeft de vorm "did:web:<host>#<fragment>". Alleen de kale hostvorm wordt
 * ondersteund (geen padsegmenten): x402-resource-origins zijn kale hosts.
 */
export async function losDidWebSleutelOp(keyId, { fetchImpl = fetch, lookup, nu = () => Date.now() } = {}) {
  const match = /^did:web:([^:#]+)#([^\n\r]+)$/.exec(String(keyId ?? ''))
  if (!match) return { outcome: 'NOT_MEASURED', reden: 'geen ondersteund did:web key_id-formaat: ' + veiligVeld(keyId) }
  const [, host, fragment] = match
  const url = 'https://' + host + '/.well-known/did.json'

  const plek = await plekIsPubliek(url, lookup ? { lookup } : {})
  if (!plek.ok) return { outcome: 'NOT_MEASURED', reden: 'host niet publiek bereikbaar: ' + plek.reden }

  let r
  try {
    r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(HAAL_TIJDSLIMIET_MS) })
  } catch (e) {
    return { outcome: 'NOT_MEASURED', reden: 'did.json niet te bereiken: ' + String(e?.message ?? e).slice(0, 120) }
  }
  if (!r.ok) {
    if (r.status >= 400 && r.status < 500) {
      return { outcome: 'FAIL', reden: 'geen did.json op ' + url + ' (http ' + r.status + ')' }
    }
    return { outcome: 'NOT_MEASURED', reden: 'did.json gaf http ' + r.status }
  }
  let tekst
  if (r.body && typeof r.body.getReader === 'function') {
    const lezer = r.body.getReader()
    const brokken = []
    let totaal = 0
    while (totaal < MAX_DOCUMENT) {
      const { done, value } = await lezer.read()
      if (done) break
      if (!value) continue
      totaal += value.byteLength ?? value.length ?? 0
      brokken.push(value)
    }
    try { await lezer.cancel() } catch { /* bron is al weg */ }
    const samen = new Uint8Array(Math.min(totaal, MAX_DOCUMENT))
    let i = 0
    for (const b of brokken) for (let k = 0; k < b.length && i < samen.length; k++) samen[i++] = b[k]
    tekst = new TextDecoder().decode(samen)
  } else {
    tekst = String(await r.text()).slice(0, MAX_DOCUMENT)
  }

  let document
  try {
    document = JSON.parse(tekst)
  } catch {
    return { outcome: 'NOT_MEASURED', reden: 'did.json is geen geldige JSON' }
  }
  const volledigeId = 'did:web:' + host + '#' + fragment
  const methodes = Array.isArray(document?.verificationMethod) ? document.verificationMethod : []
  const gevonden = methodes.find((m) => m?.id === volledigeId || m?.id === '#' + fragment)
  if (!gevonden) {
    return { outcome: 'FAIL', reden: 'geen verificationMethod met id ' + veiligVeld(volledigeId) + ' in did.json', document }
  }
  const caip10 = String(gevonden.blockchainAccountId ?? '')
  const caipMatch = /^eip155:\d+:(0x[0-9a-fA-F]{40})$/.exec(caip10)
  if (!caipMatch) {
    return { outcome: 'FAIL', reden: 'verificationMethod heeft geen eip155 blockchainAccountId', document }
  }
  return { outcome: 'PASS', adres: caipMatch[1].toLowerCase(), document, opgehaaldOm: nu() }
}

/** Verifieert de handtekening, en geeft null terug als dat niet te meten is (geen ethers). */
export async function handtekeningKlopt(receipt, verwachtAdres) {
  const ethers = await laadEthers()
  if (!ethers) return null
  const digest = handtekeningDigest(receipt)
  let herstelAdres
  try {
    herstelAdres = ethers.verifyTypedData(
      eip712DomeinVoorEthers(receipt?.issuer?.resource_origin),
      EIP712_TYPES,
      { digest },
      receipt?.signature,
    )
  } catch {
    return false
  }
  return String(herstelAdres).toLowerCase() === String(verwachtAdres ?? '').toLowerCase()
}

function eip712DomeinVoorEthers(resourceOrigin) {
  const d = eip712Domein(resourceOrigin)
  return { name: d.name, version: d.version, salt: '0x' + d.salt.toString('hex') }
}

/**
 * De hoofdtoets. `context` draagt wat de vector al WAARNAM (opgelost adres,
 * handtekening-uitslag), zodat de meeste vectoren zonder netwerk en zonder sleutel
 * draaien — exact het patroon van attempt-identity.mjs. Een vector die wil dat dit
 * pakket zelf resolvet/verifieert, laat context weg en krijgt dan de echte, async
 * paden hierboven (zie test/rejection-receipt.mjs voor de losse known-answer-toetsen
 * op de crypto zelf).
 */
export function toetsAfwijzingsBon(receipt, context = {}) {
  // context KAN expliciet null zijn (een nullable veld uit JSON, een ontbrekend
  // upstream-resultaat): de default-parameter hierboven vangt alleen `undefined`. Zonder
  // deze regel crasht een alledaagse, niet-kwaadwillende aanroep al op `context.payToAdres`.
  context = context ?? {}

  if (!receipt || typeof receipt !== 'object' || Object.keys(receipt).length === 0) {
    return { outcome: 'NOT_MEASURED', reason_code: 'nothing-recorded' }
  }

  const decision = receipt.decision ?? {}
  const obs = receipt.payment_observation ?? {}
  const binding = receipt.attempt_binding ?? {}

  // decision-outcome-and-binding-present. Zonder dit toetste de rest van deze functie
  // alleen HOE eerlijk een claim begrensd is (bewijsniveau, vocabulaire, receipt_id,
  // sleutel, handtekening), nooit WAT er geclaimd werd: een briefje met decision.outcome
  // "ACCEPTED", of zonder enige attempt_binding, kwam door een onbewaakte zijdeur alsnog
  // op PASS uit. Precies het "liegende briefje"-gat dat dit ontwerp zegt te bestrijden
  // (al-khasm, 10 nov 2026).
  if (decision.outcome !== 'REJECTED') {
    return { outcome: 'FAIL', reason_code: 'DECISION_OUTCOME_AND_BINDING_PRESENT', detail: 'outcome is not REJECTED: ' + veiligVeld(decision.outcome) }
  }
  if (!binding.payment_payload_hash || !binding.payment_requirements_hash) {
    return { outcome: 'FAIL', reason_code: 'DECISION_OUTCOME_AND_BINDING_PRESENT', detail: 'attempt_binding is missing a required hash' }
  }

  // payment-observation-vocabulary-bounded
  if (!PAYMENT_OBSERVATION_STATES.includes(obs.state)) {
    return { outcome: 'FAIL', reason_code: 'PAYMENT_OBSERVATION_VOCABULARY_BOUNDED', detail: veiligVeld(obs.state) }
  }

  // settlement-pending-not-presented-as-final
  if (obs.state === 'SETTLEMENT_PENDING' && decision.outcome === 'REJECTED' && decision.final !== false) {
    return { outcome: 'FAIL', reason_code: 'SETTLEMENT_PENDING_NOT_FINAL' }
  }

  // reason-code-bounded-fail-closed + evidence-class-not-overclaimed
  const toegestaan = REDEN_TABEL.get(decision.reason_code)
  const toegestaanNaam = toegestaan ?? 'ISSUER_ASSERTED'
  if (!EVIDENCE_CLASSES.includes(decision.evidence_class)) {
    return { outcome: 'FAIL', reason_code: 'EVIDENCE_CLASS_UNKNOWN', detail: veiligVeld(decision.evidence_class) }
  }
  if (EVIDENCE_RANG.get(decision.evidence_class) > EVIDENCE_RANG.get(toegestaanNaam)) {
    return {
      outcome: 'FAIL',
      reason_code: 'EVIDENCE_CLASS_NOT_OVERCLAIMED',
      detail: veiligVeld(decision.reason_code) + ' staat ' + toegestaanNaam + ' toe, briefje claimt ' + veiligVeld(decision.evidence_class),
    }
  }

  // receipt-id-recomputes. Een receipt met een circulaire referentie (mogelijk bij een
  // zelfgebouwde objectgraaf, nooit bij rauwe JSON) kan jcs() niet canonicaliseren: dat
  // is geen afkeuring van de inhoud, we konden simpelweg niet kijken.
  let herberekend
  try {
    herberekend = berekenReceiptId(receipt)
  } catch {
    return { outcome: 'NOT_MEASURED', reason_code: 'RECEIPT_ID_RECOMPUTES' }
  }
  if (receipt.receipt_id !== herberekend) {
    return { outcome: 'FAIL', reason_code: 'RECEIPT_ID_RECOMPUTES' }
  }

  // dedicated-signing-key-not-payto
  if (context.payToAdres && context.sleutelAdres &&
    String(context.payToAdres).toLowerCase() === String(context.sleutelAdres).toLowerCase()) {
    return { outcome: 'FAIL', reason_code: 'DEDICATED_SIGNING_KEY_NOT_PAYTO' }
  }

  // signature-verifies-against-resolved-key
  if (context.handtekeningKlopt === undefined) {
    return { outcome: 'NOT_MEASURED', reason_code: 'SIGNATURE_VERIFIES_AGAINST_RESOLVED_KEY' }
  }
  if (context.handtekeningKlopt !== true) {
    return { outcome: 'FAIL', reason_code: 'SIGNATURE_VERIFIES_AGAINST_RESOLVED_KEY' }
  }

  return { outcome: 'PASS' }
}

/**
 * Toetst twee briefjes die naar DEZELFDE attempt-binding wijzen op tegenstrijdigheid.
 * Geen Merkle-log nodig: twee door dezelfde sleutel ondertekende documenten over
 * hetzelfde attempt_binding bewijzen zichzelf zodra ze naast elkaar liggen.
 */
export function toetsTegenstrijdigheid(a, b) {
  // Geen van beide draagt een attempt_binding: er is dan niets om tegen te vergelijken.
  // Zonder deze regel maakte `JSON.stringify(undefined ?? null)` twee kapotte briefjes
  // op elkaar GELIJK (allebei "null"), en gaf dat een vals, stellig "geen conflict".
  if (a?.attempt_binding == null || b?.attempt_binding == null) {
    return { outcome: 'NOT_MEASURED', reason_code: 'binding-not-recorded' }
  }
  let bindingA, bindingB
  try {
    bindingA = JSON.stringify(a.attempt_binding)
    bindingB = JSON.stringify(b.attempt_binding)
  } catch {
    // Een circulaire attempt_binding: niet iets dat over de rauwe JSON-draad kan
    // aankomen, maar wel mogelijk via een zelf opgebouwde objectgraaf. Niet gemeten,
    // nooit stilzwijgend "gelijk" of "ongelijk" geraden.
    return { outcome: 'NOT_MEASURED', reason_code: 'binding-not-comparable' }
  }
  if (bindingA !== bindingB) return { outcome: 'NOT_MEASURED', reason_code: 'different-binding' }
  const gelijk = a?.decision?.outcome === b?.decision?.outcome && a?.decision?.reason_code === b?.decision?.reason_code
  return gelijk
    ? { outcome: 'PASS' }
    : { outcome: 'FAIL', reason_code: 'NO_EQUIVOCATION_FOR_SAME_BINDING', detail: 'CONFLICT_DETECTED' }
}

// Een ingang, zelfde bedoeling als attempt-identity.mjs: een regel om te draaien, geen
// bestand dat iemand moet vinden. Zonder sleutel, zonder account, zonder netwerk. Dit is
// bewust een KLEINERE lus dan test/rejection-receipt.mjs: die draagt de dekkingsmeting en
// de echte crypto/did:web-toetsen, dit draagt alleen "doet elke vector wat verwacht is".
//
// WAAROM EEN EXACTE PADVERGELIJKING EN GEEN `endsWith('rejection-receipt.mjs')`. Dat
// laatste patroon staat zo in attempt-identity.mjs, en bleek daar ZELF kapot: zowel
// src/attempt-identity.mjs als test/attempt-identity.mjs eindigen op diezelfde naam, dus
// het importeren van de module vanuit zijn EIGEN testbestand triggerde de CLI-lus mee,
// onzichtbaar in de testuitvoer. Gemeten, niet aangenomen: `node test/attempt-identity.mjs`
// drukt 72 "ok/FAIL"-CLI-regels af NAAST de 57 eigen pass/FAIL-regels. Dezelfde fout hier
// overnemen zou test/rejection-receipt.mjs's eigen uitvoer op identieke wijze vervuild
// hebben. Zie kennisgat "CLI-zelfherkenning met endsWith triggert ook bij import" voor de
// gemelde, nog niet gerepareerde broer in attempt-identity.mjs.
const ditBestand = fileURLToPath(import.meta.url)
if (process.argv[1] && padResolve(process.argv[1]) === padResolve(ditBestand)) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const map = path.join(path.dirname(ditBestand), '..', 'vectors', 'rejection-receipt')
  const bestanden = fs.readdirSync(map).filter((b) => b.endsWith('.json')).sort()
  let past = 0
  for (const b of bestanden) {
    const v = JSON.parse(fs.readFileSync(path.join(map, b), 'utf8'))
    const i = v.input
    const u = i.receiptA !== undefined ? toetsTegenstrijdigheid(i.receiptA, i.receiptB) : toetsAfwijzingsBon(i.receipt, i.context ?? {})
    const ok = u.outcome === v.expected.outcome && (v.expected.reason_code === undefined || u.reason_code === v.expected.reason_code)
    if (ok) past++
    console.log((ok ? '  ok   ' : '  FAIL ') + b.replace('.json', '').padEnd(48) + u.outcome + (u.reason_code ? ' / ' + u.reason_code : ''))
  }
  console.log('')
  console.log(past + ' of ' + bestanden.length + ' vectors behave as recorded, across ' + CLAUSULES.length + ' clauses of our own rejection-receipt design (not an x402 spec).')
  console.log('Every clause carries one acceptance and at least one refusal. No account, no key, no network.')
  if (past !== bestanden.length) process.exitCode = 1
}
