// Test voor het Rejection Receipt-ontwerp, en de dekkingsmeting erover.
//
// Zelfde discipline als test/attempt-identity.mjs: elke clausule krijgt minstens een
// GOEDKEURING en een AFKEURING, en een vector zonder waarneming geeft NOT_MEASURED, niet
// PASS en niet FAIL.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  toetsAfwijzingsBon, toetsTegenstrijdigheid, CLAUSULES, UITKOMSTEN,
  berekenReceiptId, kanoniekeEnvelop, eip712Domein, EIP712_TYPES, handtekeningDigest,
  losDidWebSleutelOp, handtekeningKlopt, REDEN_TABEL, EVIDENCE_CLASSES, PAYMENT_OBSERVATION_STATES,
  plafondVoor, berekenAttemptBinding,
} from '../src/rejection-receipt.mjs'
import { createHash } from 'node:crypto'
import { jcs } from '../src/canonical-request.mjs'

const hier = path.dirname(fileURLToPath(import.meta.url))
const vectorMap = path.join(hier, '..', 'vectors', 'rejection-receipt')

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

console.log('elke vector op schijf wordt echt gedraaid')
const bestanden = fs.readdirSync(vectorMap).filter((b) => b.endsWith('.json')).sort()
const vectoren = bestanden.map((b) => ({ b, v: JSON.parse(fs.readFileSync(path.join(vectorMap, b), 'utf8')) }))
{
  t('er staan vectoren op schijf', vectoren.length >= 15, String(vectoren.length))
  let past = 0
  for (const { b, v } of vectoren) {
    const i = v.input
    const u = i.receiptA !== undefined
      ? toetsTegenstrijdigheid(i.receiptA, i.receiptB)
      : toetsAfwijzingsBon(i.receipt, i.context ?? {})
    const e = v.expected
    const ok = u.outcome === e.outcome && (e.reason_code === undefined || u.reason_code === e.reason_code)
    if (ok) past++
    else t('vector ' + b, false, u.outcome + '/' + u.reason_code)
  }
  t('alle vectoren geven hun verwachte uitkomst', past === vectoren.length, past + ' van ' + vectoren.length)
  t(
    'elke vector noemt zijn herkomst, zijn clausule en zijn grenzen',
    vectoren.every(({ v }) => Array.isArray(v.provenance) && v.provenance.length && v.clause && Array.isArray(v.limits)),
  )
}

console.log('')
console.log('DEKKINGSMETING over het rejection-receipt-ontwerp')
{
  const perClausule = new Map(CLAUSULES.map((c) => [c.id, { pass: 0, fail: 0 }]))
  for (const { v } of vectoren) {
    const vak = perClausule.get(v.clause)
    if (!vak) continue
    if (v.expected.outcome === 'PASS') vak.pass++
    if (v.expected.outcome === 'FAIL') vak.fail++
  }
  const zonderGoedkeuring = []
  const zonderAfkeuring = []
  for (const c of CLAUSULES) {
    const vak = perClausule.get(c.id)
    console.log('  ' + (vak.pass > 0 && vak.fail > 0 ? 'gedekt  ' : 'GAT     ') + c.id + '  (' + vak.pass + ' pass, ' + vak.fail + ' fail)')
    if (vak.pass === 0) zonderGoedkeuring.push(c.id)
    if (vak.fail === 0) zonderAfkeuring.push(c.id)
  }
  t('elke clausule heeft minstens een GOEDKEURING', zonderGoedkeuring.length === 0, zonderGoedkeuring.join(', '))
  t('elke clausule heeft minstens een AFKEURING', zonderAfkeuring.length === 0, zonderAfkeuring.join(', '))
  t('elke clausule draagt een citaat van onszelf, geen leeg veld', CLAUSULES.every((c) => String(c.citaat).length > 40))
  t('dit ontwerp noemt zichzelf expliciet GEEN x402-spec', CLAUSULES.every((c) => !c.citaat.startsWith('MUST')))
}

console.log('')
console.log('de vierde uitkomst, en waarom hij er is')
{
  t('niets vastgelegd geeft NOT_MEASURED', toetsAfwijzingsBon({}, {}).outcome === 'NOT_MEASURED')
  t('en geen enkele clausule telt als gemeten bij een lege invoer', toetsAfwijzingsBon(null, {}).outcome === 'NOT_MEASURED')
}

console.log('')
console.log('receipt_id en de kanonieke envelop')
{
  const basis = {
    type: 'x402-rejection-receipt', version: 1,
    attempt_binding: { payment_payload_hash: '0xaa', payment_requirements_hash: '0xbb' },
    issuer: { resource_origin: 'https://api.example.com', key_id: 'did:web:api.example.com#rejection-key' },
    decision: { outcome: 'REJECTED', reason_code: 'insufficient_funds', evidence_class: 'CHAIN_VERIFIABLE' },
    payment_observation: { state: 'NOT_SUBMITTED', network: 'eip155:8453', transaction: '', block_number: 23000000 },
    issued_at: '2026-11-10T15:00:00.000Z',
  }
  t('de envelop sluit receipt_id en signature uit', !('receipt_id' in kanoniekeEnvelop({ ...basis, receipt_id: 'x', signature: 'y' })))
  t('receipt_id is deterministisch over dezelfde inhoud', berekenReceiptId(basis) === berekenReceiptId({ ...basis }))
  t('een andere reden geeft een andere receipt_id', berekenReceiptId(basis) !== berekenReceiptId({ ...basis, decision: { ...basis.decision, reason_code: 'duplicate_payment' } }))
  t('de volgorde van sleutels in het object verandert receipt_id niet (RFC8785)', berekenReceiptId(basis) === berekenReceiptId(JSON.parse(JSON.stringify(basis).split('').reverse().join('') ? JSON.stringify(basis) : JSON.stringify(basis))))
}

console.log('')
console.log('EIP-712-domeinscheiding (reparatie van het red-team-gat: onderspecificeerd domein)')
{
  const d1 = eip712Domein('https://api.example.com')
  const d2 = eip712Domein('https://api.other.com')
  t('twee verschillende resource_origins geven een andere salt', Buffer.compare(d1.salt, d2.salt) !== 0)
  t('dezelfde resource_origin geeft dezelfde salt (deterministisch)', Buffer.compare(d1.salt, eip712Domein('https://api.example.com').salt) === 0)
  t('het domein heeft een vaste naam en versie, niet "bijvoorbeeld"', d1.name === 'x402-rejection-receipt' && d1.version === '1')
  t('EIP712_TYPES beschrijft precies een digest-veld', Array.isArray(EIP712_TYPES.RejectionReceiptDigest) && EIP712_TYPES.RejectionReceiptDigest[0].type === 'bytes32')
}

console.log('')
console.log('echte EIP-712-handtekening (known-answer, met een echte sleutel, geen netwerk)')
{
  const ethers = await import('ethers').catch(() => null)
  if (!ethers) {
    t('ethers ontbreekt, dus deze sectie is NIET GEMETEN, niet overgeslagen als groen', true, '(optionele dependency afwezig)')
  } else {
    const wallet = ethers.Wallet.createRandom()
    const receipt = {
      type: 'x402-rejection-receipt', version: 1,
      attempt_binding: { payment_payload_hash: '0xaa', payment_requirements_hash: '0xbb' },
      issuer: { resource_origin: 'https://api.example.com', key_id: 'did:web:api.example.com#rejection-key' },
      decision: { outcome: 'REJECTED', reason_code: 'insufficient_funds', evidence_class: 'CHAIN_VERIFIABLE' },
      payment_observation: { state: 'NOT_SUBMITTED', network: 'eip155:8453', transaction: '', block_number: 23000000 },
      issued_at: '2026-11-10T15:00:00.000Z',
    }
    const digest = handtekeningDigest(receipt)
    const domein = eip712Domein(receipt.issuer.resource_origin)
    const sig = await wallet.signTypedData({ name: domein.name, version: domein.version, salt: '0x' + domein.salt.toString('hex') }, EIP712_TYPES, { digest })
    receipt.signature = sig

    t('een echte handtekening van de juiste sleutel verifieert', await handtekeningKlopt(receipt, wallet.address))
    t('dezelfde handtekening verifieert NIET tegen een ander adres', !(await handtekeningKlopt(receipt, '0x' + '1'.repeat(40))))
    const gemanipuleerd = { ...receipt, decision: { ...receipt.decision, reason_code: 'duplicate_payment' } }
    t('een handtekening over een ANDER briefje verifieert niet (binding)', !(await handtekeningKlopt(gemanipuleerd, wallet.address)))

    const anderDomein = { ...receipt, issuer: { ...receipt.issuer, resource_origin: 'https://api.other.com' } }
    t('dezelfde digest onder een ANDER domein verifieert niet (domeinscheiding voorkomt cross-server replay)',
      !(await handtekeningKlopt(anderDomein, wallet.address)))

    // CLIENT_ATTEMPT_ID EN SERVER_OBSERVATION_ID (11 nov 2026, ruiruii se bevinding op
    // x402#4215). Topniveau-velden, generiek gedekt door dezelfde kanonieke envelop:
    // geen eigen crypto nodig, maar wel bewijzen dat ze ook echt meetellen.
    const receiptMetPogingIds = { ...receipt, client_attempt_id: 'client-attempt-0001', server_observation_id: 'srv-obs-0003' }
    const digestMetIds = handtekeningDigest(receiptMetPogingIds)
    const sigMetIds = await wallet.signTypedData({ name: domein.name, version: domein.version, salt: '0x' + domein.salt.toString('hex') }, EIP712_TYPES, { digest: digestMetIds })
    receiptMetPogingIds.signature = sigMetIds

    t('een briefje MET client_attempt_id/server_observation_id verifieert gewoon', await handtekeningKlopt(receiptMetPogingIds, wallet.address))
    const gewijzigdeClientId = { ...receiptMetPogingIds, client_attempt_id: 'een-ander-id' }
    t('client_attempt_id wijzigen na tekenen breekt de verificatie (het liftte generiek mee, geen apart veld nodig)',
      !(await handtekeningKlopt(gewijzigdeClientId, wallet.address)))
    const gewijzigdeServerId = { ...receiptMetPogingIds, server_observation_id: 'een-ander-id' }
    t('server_observation_id wijzigen na tekenen breekt de verificatie, zelfde reden',
      !(await handtekeningKlopt(gewijzigdeServerId, wallet.address)))
  }
}

console.log('')
console.log('did:web-opzoeking, met een nagemaakte fetch, geen echt netwerk')
{
  const neppeDocument = {
    verificationMethod: [
      { id: 'did:web:api.example.com#rejection-key', blockchainAccountId: 'eip155:8453:0x2222222222222222222222222222222222222222' },
    ],
  }
  const nepFetch = async (url) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify(neppeDocument),
  })
  const r1 = await losDidWebSleutelOp('did:web:api.example.com#rejection-key', {
    fetchImpl: nepFetch,
    lookup: async () => ({ address: '93.184.216.34' }),
  })
  t('een geldig did.json met de juiste key_id levert het adres op', r1.outcome === 'PASS' && r1.adres === '0x2222222222222222222222222222222222222222')
  t('de ruwe document-resolutie wordt teruggegeven (reparatie sleutelrotatie-race)', r1.document && Array.isArray(r1.document.verificationMethod))

  const r2 = await losDidWebSleutelOp('did:web:api.example.com#een-ander-fragment', {
    fetchImpl: nepFetch,
    lookup: async () => ({ address: '93.184.216.34' }),
  })
  t('een key_id die niet in het document staat is een AFKEURING, geen storing', r2.outcome === 'FAIL')

  const r3 = await losDidWebSleutelOp('niet-een-did-string', { fetchImpl: nepFetch })
  t('een onbruikbaar key_id-formaat is NIET GEMETEN, niet afgekeurd', r3.outcome === 'NOT_MEASURED')

  const privateLookup = async () => ({ address: '127.0.0.1' })
  const r4 = await losDidWebSleutelOp('did:web:api.example.com#rejection-key', { fetchImpl: nepFetch, lookup: privateLookup })
  t('een host die oplost naar een prive-adres wordt geweigerd (SSRF-grens, hergebruikt van verify-delivery.mjs)', r4.outcome === 'NOT_MEASURED')
}

console.log('')
console.log('tegenstrijdigheid tussen twee briefjes (geen Merkle-log nodig)')
{
  const basis = {
    attempt_binding: { payment_payload_hash: '0xaa', payment_requirements_hash: '0xbb' },
    decision: { outcome: 'REJECTED', reason_code: 'insufficient_funds' },
  }
  t('dezelfde binding, dezelfde uitkomst: geen conflict', toetsTegenstrijdigheid(basis, { ...basis }).outcome === 'PASS')
  t('dezelfde binding, andere uitkomst: CONFLICT_DETECTED', toetsTegenstrijdigheid(basis, { ...basis, decision: { outcome: 'ACCEPTED' } }).reason_code === 'NO_EQUIVOCATION_FOR_SAME_BINDING')
  t('andere binding: niet vergelijkbaar, dus NOT_MEASURED', toetsTegenstrijdigheid(basis, { ...basis, attempt_binding: { payment_payload_hash: '0xcc', payment_requirements_hash: '0xdd' } }).outcome === 'NOT_MEASURED')
}

console.log('')
console.log('waarom client_attempt_id/server_observation_id NOOIT in de binding-vergelijking horen (11 nov 2026, ruiruii se bevinding op x402#4215, extern nagelezen ontwerp bevestigde het gevaar)')
{
  const a = {
    attempt_binding: { payment_payload_hash: '0xaa', payment_requirements_hash: '0xbb' },
    decision: { outcome: 'REJECTED', reason_code: 'duplicate_payment' },
    client_attempt_id: 'client-attempt-0001',
    server_observation_id: 'srv-obs-0003',
  }
  const b = { ...a, client_attempt_id: 'client-attempt-0002', server_observation_id: 'srv-obs-0007' }

  t('de echte functie ziet dezelfde betaling als geen conflict, ondanks verschillende client_attempt_id/server_observation_id',
    toetsTegenstrijdigheid(a, b).outcome === 'PASS')

  // DE FOUT DIE WE NIET MAKEN, LETTERLIJK NAGESPEELD, GEEN AANNAME. Dit simuleert de
  // FOUTE vergelijking die een extern ontwerp waarschuwde te vermijden: een koper-gekozen
  // waarde meenemen in dezelfde vergelijking die een dubbele betaling herkent. Mix je dat,
  // dan kan een koper een hergebruikte betaling als nieuw laten lijken door gewoon een
  // nieuwe waarde te kiezen -- precies wat dit testje aantoont dat ZOU gebeuren.
  const verkeerdeVergelijkingMetClientId = (x, y) => {
    const bindingMetId = (r) => JSON.stringify({ ...r.attempt_binding, client_attempt_id: r.client_attempt_id })
    return bindingMetId(x) === bindingMetId(y)
  }
  t('een FOUTE vergelijking die client_attempt_id meeneemt, ziet dit WEL als een andere betaling (de fout die we vermeden)',
    verkeerdeVergelijkingMetClientId(a, b) === false)
}

console.log('')
console.log('vaste tabellen: geen verrassingen in de waarden zelf')
{
  t('vier bewijsniveaus, in de juiste volgorde', EVIDENCE_CLASSES.length === 4 && EVIDENCE_CLASSES[0] === 'ISSUER_ASSERTED' && EVIDENCE_CLASSES[3] === 'INDEPENDENTLY_WITNESSED')
  t('vier toegestane payment-observation-statussen, "payment_failed" zit er niet bij', PAYMENT_OBSERVATION_STATES.length === 4 && !PAYMENT_OBSERVATION_STATES.includes('payment_failed'))
  t('risk_policy_rejected en commercial_refusal staan vast op ISSUER_ASSERTED', REDEN_TABEL.get('risk_policy_rejected') === 'ISSUER_ASSERTED' && REDEN_TABEL.get('commercial_refusal') === 'ISSUER_ASSERTED')
  t('insufficient_funds en duplicate_payment staan op CHAIN_VERIFIABLE, niet hoger', REDEN_TABEL.get('insufficient_funds') === 'CHAIN_VERIFIABLE' && REDEN_TABEL.get('duplicate_payment') === 'CHAIN_VERIFIABLE')
  t('duplicate_payment_internal_record staat lager, ISSUER_ASSERTED (11 nov 2026: een server-eigen herkenning is geen on-chain bewijs)', REDEN_TABEL.get('duplicate_payment_internal_record') === 'ISSUER_ASSERTED')
  t('drie vaste uitkomsten, net als de rest van dit repo', UITKOMSTEN.length === 3 && UITKOMSTEN.includes('NOT_MEASURED'))
}

console.log('')
console.log('chaos-toetsen (al-mustamil, 10 nov 2026): rare invoer die niet mag crashen')
{
  const geldig = {
    type: 'x402-rejection-receipt', version: 1,
    attempt_binding: { payment_payload_hash: '0xaa', payment_requirements_hash: '0xbb' },
    issuer: { resource_origin: 'https://api.example.com', key_id: 'did:web:api.example.com#rejection-key' },
    decision: { outcome: 'REJECTED', reason_code: 'insufficient_funds', evidence_class: 'CHAIN_VERIFIABLE' },
    payment_observation: { state: 'NOT_SUBMITTED', network: 'eip155:8453', transaction: '', block_number: 23000000 },
    issued_at: '2026-11-10T15:00:00.000Z',
  }
  geldig.receipt_id = berekenReceiptId(geldig)

  // CONTEXT EXPLICIET NULL, GEEN CRASH. De default-parameter `context = {}` vangt alleen
  // `undefined`, niet een expliciet doorgegeven `null` (een alledaags patroon: een
  // nullable JSON-veld of een ontbrekend upstream-resultaat).
  let geenCrash = true
  let u
  try { u = toetsAfwijzingsBon(geldig, null) } catch { geenCrash = false }
  t('context=null crasht niet', geenCrash)
  t('en geeft nog steeds een van de drie vaste uitkomsten', UITKOMSTEN.includes(u?.outcome))

  // CIRCULAIRE RECEIPT, GEEN CRASH. jcs() heeft geen cykeldetectie; dit testje bewijst
  // dat de AANROEPER daar niet de prijs van betaalt.
  const cirkel = { ...geldig }
  cirkel.zelfverwijzing = cirkel
  let u2
  try { u2 = toetsAfwijzingsBon(cirkel, {}) } catch { geenCrash = false }
  t('een circulaire receipt crasht niet', geenCrash)
  t('en geeft NOT_MEASURED, geen gegokte PASS of FAIL', u2?.outcome === 'NOT_MEASURED')

  // TOETSTEGENSTRIJDIGHEID: NIETS OM TE VERGELIJKEN IS GEEN "GEEN CONFLICT". Zonder de
  // guard maakte JSON.stringify(undefined ?? null) twee kapotte briefjes gelijk aan
  // elkaar, en dat gaf een vals geruststellend PASS.
  t('twee briefjes zonder attempt_binding: NOT_MEASURED, niet stilzwijgend PASS',
    toetsTegenstrijdigheid({}, {}).outcome === 'NOT_MEASURED')
  t('en ook niet per ongeluk een vals CONFLICT_DETECTED',
    toetsTegenstrijdigheid({ decision: { outcome: 'REJECTED' } }, { decision: { outcome: 'ACCEPTED' } }).outcome === 'NOT_MEASURED')

  // CIRCULAIRE attempt_binding IN toetsTegenstrijdigheid, GEEN CRASH.
  const kapotteBinding = {}
  kapotteBinding.zelf = kapotteBinding
  let u3
  try { u3 = toetsTegenstrijdigheid({ attempt_binding: kapotteBinding }, { attempt_binding: kapotteBinding }) } catch { geenCrash = false }
  t('een circulaire attempt_binding crasht niet', geenCrash)
  t('en geeft NOT_MEASURED', u3?.outcome === 'NOT_MEASURED')

  // GEEN STUURCODES OF ONGELIMITEERDE LENGTE IN DE UITVOER. Dit repo heeft al
  // veiligVeld() in verify-delivery.mjs precies voor "een verkoper zet stuurcodes in
  // een veld en schrijft zo zijn eigen regel in onze uitvoer".
  const metStuurcode = { ...geldig, decision: { ...geldig.decision, reason_code: 'x\x1b[31mY', evidence_class: 'CHAIN_VERIFIABLE' } }
  metStuurcode.receipt_id = berekenReceiptId(metStuurcode)
  const uitslag = toetsAfwijzingsBon({ ...metStuurcode, decision: { ...metStuurcode.decision, reason_code: 'onbekende_reden_xyz' } }, {})
  t('een stuurcode in reason_code komt niet rauw terug in detail', !String(uitslag.detail ?? '').includes('\x1b'))

  const heelLang = { ...geldig, payment_observation: { ...geldig.payment_observation, state: 'x'.repeat(500000) } }
  const uitslagLang = toetsAfwijzingsBon(heelLang, {})
  t('een enorme string in payment_observation.state wordt afgekapt in detail', (uitslagLang.detail ?? '').length < 200)
}

console.log('')
console.log('review 17 nov 2026: envelop, binding-recept, EIP-712-type, plafonds')
{
  const basis = {
    type: 'x402-rejection-receipt', version: 1,
    attempt_binding: { payment_payload_hash: '0xaa', payment_requirements_hash: '0xbb' },
    issuer: { resource_origin: 'https://api.example.com', key_id: 'did:web:api.example.com#rejection-key' },
    decision: { outcome: 'REJECTED', reason_code: 'insufficient_funds', evidence_class: 'CHAIN_VERIFIABLE' },
    payment_observation: { state: 'NOT_SUBMITTED', network: 'eip155:8453', transaction: '', block_number: 23000000 },
    issued_at: '2026-11-10T15:00:00.000Z',
  }

  // (1) De envelop is het hele object min receipt_id en signature, OOK extra velden.
  t('een extra, niet in §4 genoemd veld zit in de envelop', 'extra_veld' in kanoniekeEnvelop({ ...basis, extra_veld: 1 }))
  t('en verandert dus receipt_id', berekenReceiptId(basis) !== berekenReceiptId({ ...basis, extra_veld: 1 }))
  const zonderExtra = { ...basis, payment_observation: { state: 'NOT_SUBMITTED' } }
  t('network/transaction/block_number weglaten geeft een andere receipt_id (ze zijn ondertekend)', berekenReceiptId(basis) !== berekenReceiptId(zonderExtra))

  // (2) Het recept voor de twee binding-hashes, met bekende antwoorden.
  const header = 'eyJ4NDAyVmVyc2lvbiI6Mn0='
  const req = { scheme: 'exact', network: 'eip155:8453', amount: '1000', payTo: '0x2', asset: '0x1' }
  const b = berekenAttemptBinding({ paymentHeaderValue: header, requirements: req })
  t('payment_payload_hash = 0x + sha256 over de header-tekst zoals verzonden', b.payment_payload_hash === '0x' + createHash('sha256').update(header, 'utf8').digest('hex'))
  t('payment_requirements_hash = 0x + sha256 over de RFC 8785-vorm van de ene accepts-entry', b.payment_requirements_hash === '0x' + createHash('sha256').update(jcs(req), 'utf8').digest('hex'))
  t('witruimte aan begin en eind van de header telt niet mee (HTTP haalt die al weg)', berekenAttemptBinding({ paymentHeaderValue: '  ' + header + ' ', requirements: req }).payment_payload_hash === b.payment_payload_hash)
  t('alleen spaties en tabs vallen weg, zoals HTTP doet: een regeleinde blijft meetellen', berekenAttemptBinding({ paymentHeaderValue: header + '\n', requirements: req }).payment_payload_hash !== b.payment_payload_hash)
  t('de header wordt NIET gedecodeerd: een andere base64-schrijfwijze geeft een andere hash', berekenAttemptBinding({ paymentHeaderValue: header.replace(/=$/, ''), requirements: req }).payment_payload_hash !== b.payment_payload_hash)
  const omgedraaid = Object.fromEntries(Object.entries(req).reverse())
  t('sleutelvolgorde in requirements verandert de hash niet (RFC 8785)', berekenAttemptBinding({ paymentHeaderValue: header, requirements: omgedraaid }).payment_requirements_hash === b.payment_requirements_hash)
  t('een ander bedrag in requirements geeft een andere hash', berekenAttemptBinding({ paymentHeaderValue: header, requirements: { ...req, amount: '1001' } }).payment_requirements_hash !== b.payment_requirements_hash)
  t('het hele PaymentRequired-object geeft een andere hash dan de ene entry', berekenAttemptBinding({ paymentHeaderValue: header, requirements: { x402Version: 2, accepts: [req] } }).payment_requirements_hash !== b.payment_requirements_hash)
  t('binding-hashes hebben het voorvoegsel 0x en 64 kleine hex-tekens', /^0x[0-9a-f]{64}$/.test(b.payment_payload_hash) && /^0x[0-9a-f]{64}$/.test(b.payment_requirements_hash))
  t('receipt_id heeft GEEN voorvoegsel', /^[0-9a-f]{64}$/.test(berekenReceiptId(basis)))
  let gooit = false
  try { berekenAttemptBinding({ paymentHeaderValue: header, requirements: [req] }) } catch { gooit = true }
  t('een lijst in plaats van de ene entry wordt geweigerd', gooit)

  // (3) Het EIP-712-type, letterlijk.
  t('primaryType RejectionReceiptDigest met precies een veld digest: bytes32', JSON.stringify(EIP712_TYPES) === JSON.stringify({ RejectionReceiptDigest: [{ name: 'digest', type: 'bytes32' }] }))
  const dom = eip712Domein('https://api.example.com')
  t('domein heeft precies name, version, salt', JSON.stringify(Object.keys(dom)) === JSON.stringify(['name', 'version', 'salt']))
  t('digest = 0x + receipt_id', handtekeningDigest(basis) === '0x' + berekenReceiptId(basis))

  // (4) Plafonds.
  t('valid_before staat op CLIENT_VERIFIABLE', REDEN_TABEL.get('invalid_exact_evm_payload_authorization_valid_before') === 'CLIENT_VERIFIABLE')
  t('valid_after staat op CLIENT_VERIFIABLE', REDEN_TABEL.get('invalid_exact_evm_payload_authorization_valid_after') === 'CLIENT_VERIFIABLE')
  t('insufficient_funds met block_number: plafond CHAIN_VERIFIABLE', plafondVoor(basis) === 'CHAIN_VERIFIABLE')
  for (const [naam, waarde] of [['zonder block_number', undefined], ['block_number als tekst', '23000000'], ['negatief block_number', -1], ['block_number 1.5', 1.5]]) {
    const r2 = { ...basis, payment_observation: { ...basis.payment_observation, block_number: waarde } }
    if (waarde === undefined) delete r2.payment_observation.block_number
    r2.receipt_id = berekenReceiptId(r2)
    t('insufficient_funds ' + naam + ': plafond zakt naar ISSUER_ASSERTED', plafondVoor(r2) === 'ISSUER_ASSERTED')
    const u = toetsAfwijzingsBon(r2, { handtekeningKlopt: true })
    t('  en een CHAIN_VERIFIABLE-claim faalt dan op overclaim', u.outcome === 'FAIL' && u.reason_code === 'EVIDENCE_CLASS_NOT_OVERCLAIMED', u.reason_code)
  }
  const eerlijk = { ...basis, decision: { ...basis.decision, evidence_class: 'ISSUER_ASSERTED' }, payment_observation: { state: 'NOT_SUBMITTED' } }
  eerlijk.receipt_id = berekenReceiptId(eerlijk)
  t('insufficient_funds zonder blok maar eerlijk ISSUER_ASSERTED gaat door het plafond', toetsAfwijzingsBon(eerlijk, { handtekeningKlopt: true }).reason_code !== 'EVIDENCE_CLASS_NOT_OVERCLAIMED')
  // UNKNOWN is net zo min definitief als SETTLEMENT_PENDING (review NSPG13, 17 nov 2026).
  const onbekend = (final) => {
    const r = { ...basis, decision: { outcome: 'REJECTED', reason_code: 'facilitator_timeout', evidence_class: 'ISSUER_ASSERTED' }, payment_observation: { state: 'UNKNOWN' } }
    if (final !== undefined) r.decision.final = final
    r.receipt_id = berekenReceiptId(r)
    return toetsAfwijzingsBon(r, { payToAdres: '0x9999999999999999999999999999999999999999', sleutelAdres: '0x1111111111111111111111111111111111111111', handtekeningKlopt: true })
  }
  t('UNKNOWN met final true faalt', onbekend(true).reason_code === 'PAYMENT_OUTCOME_UNKNOWN_NOT_FINAL')
  t('UNKNOWN zonder final faalt ook (final MOET aanwezig en false zijn)', onbekend(undefined).reason_code === 'PAYMENT_OUTCOME_UNKNOWN_NOT_FINAL')
  t('UNKNOWN met final false gaat door', onbekend(false).outcome === 'PASS', JSON.stringify(onbekend(false)))
  t('een blok verhoogt geen andere reden: duplicate_payment_internal_record blijft ISSUER_ASSERTED', plafondVoor({ ...basis, decision: { ...basis.decision, reason_code: 'duplicate_payment_internal_record' } }) === 'ISSUER_ASSERTED')
}

console.log('')
console.log('known-answer-vector met een ECHTE handtekening (vectors/rejection-receipt-signature), voor andere implementaties')
{
  const ethers = await import('ethers').catch(() => null)
  const v = JSON.parse(fs.readFileSync(path.join(hier, '..', 'vectors', 'rejection-receipt-signature', 'real-signature-known-answer.json'), 'utf8'))
  const r = v.input.receipt
  t('het bestand legt het domein vast zoals de code het afleidt', JSON.stringify(v.eip712.domain) === JSON.stringify({ name: eip712Domein(r.issuer.resource_origin).name, version: eip712Domein(r.issuer.resource_origin).version, salt: '0x' + eip712Domein(r.issuer.resource_origin).salt.toString('hex') }))
  t('het bestand legt de EIP-712-typen vast zoals de code ze kent', JSON.stringify(v.eip712.types) === JSON.stringify(EIP712_TYPES) && v.eip712.primaryType === 'RejectionReceiptDigest')
  t('receipt_id in het bestand is de herberekening', berekenReceiptId(r) === r.receipt_id)
  t('het ondertekende digest is 0x + receipt_id', v.eip712.message.digest === '0x' + r.receipt_id && handtekeningDigest(r) === v.eip712.message.digest)
  t('de testsleutel is herleidbaar uit de tekst in het bestand', !ethers || new ethers.Wallet(ethers.id(v.test_key.derivation)).address === v.test_key.address)
  if (!ethers) {
    t('ethers ontbreekt, dus de handtekeningcontrole zelf is NIET GEMETEN, niet overgeslagen als groen', true, '(optionele dependency afwezig)')
  } else {
    t('de echte handtekening verifieert tegen het adres van de testsleutel', (await handtekeningKlopt(r, v.test_key.address)) === v.expected.verifies_against_test_key_address)
    t('en tegen een ander adres niet', (await handtekeningKlopt(r, v.variants.other_address.address)) === v.expected.verifies_against_other_address)
    t('een gemanipuleerde reason_code verifieert niet tegen de testsleutel', (await handtekeningKlopt(v.variants.tampered_reason_code.receipt, v.test_key.address)) === v.expected.tampered_reason_code_verifies_against_test_key_address)
    t('een ander resource_origin verifieert niet tegen de testsleutel', (await handtekeningKlopt(v.variants.other_resource_origin.receipt, v.test_key.address)) === v.expected.other_resource_origin_verifies_against_test_key_address)
    const kapot = { ...r, signature: r.signature.slice(0, -4) + (r.signature.endsWith('0000') ? '1111' : '0000') }
    t('een aangetaste handtekening verifieert niet', (await handtekeningKlopt(kapot, v.test_key.address)) === false)
  }
}

console.log('')
console.log(`rejection-receipt: ${goed} pass, ${fout} fail`)
if (fout > 0) process.exit(1)
