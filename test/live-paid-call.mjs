// Test voor research/live-paid-call-2026-11-16: de herberekening van drie echte betaalde aanroepen.
//
// De positieve controle staat eerst: de onaangetaste bestanden moeten alles groen geven,
// anders bewijst een rij afkeuringen alleen dat het script nee zegt. Daarna wordt in elke
// invoer een fout geplant (waarde wijzigen, weghalen, toevoegen, wisselen, leegmaken,
// afkappen) en moet precies de bijbehorende controle rood worden. Zonder die proef weet
// niemand of een groene uitslag iets betekent.
//
// Twee gevallen leggen de grens van de verkoper-hash vast: een wijziging in summary of
// meta, en een knutselaar die de hash zelf opnieuw uitrekent. Beide mogen de hash-regel
// NIET rood maken en moeten door de binding met het record gevangen worden.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAll, loadFixtures, responseHashOf, jcs } from '../research/live-paid-call-2026-11-16/reproduce.mjs'
import { onafhankelijkheid } from '../src/acceptance-binding.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAP = path.join(HERE, '..', 'research', 'live-paid-call-2026-11-16')
let goed = 0
let fout = 0
function t(naam, voorwaarde, detail) {
  if (voorwaarde) { goed++; console.log('  groen  ' + naam) } else { fout++; console.log('  ROOD   ' + naam + (detail ? '  (' + detail + ')' : '')) }
}

const kloon = (d) => ({
  seller: { ...d.seller },
  keys: JSON.parse(JSON.stringify(d.keys)),
  purchases: d.purchases.map((p) => ({
    ...p,
    input: { ...p.input },
    record: JSON.parse(JSON.stringify(p.record)),
    bodyBytes: Buffer.from(p.bodyBytes),
    criteriaBytes: Buffer.from(p.criteriaBytes),
  })),
})
const tekst = (b) => Buffer.from(b).toString('utf8')
const uitslag = (d, i) => Object.fromEntries(verifyAll(d).results[i].checks.map((c) => [c.id, c.ok]))
const rood = new Set()

// naam, mutatie op een kloon, welk aankoopnummer (index), controles die rood MOETEN zijn,
// controles die groen MOETEN blijven.
function geval(naam, mutatie, i, moetRood, moetGroen = []) {
  const d = kloon(loadFixtures())
  mutatie(d)
  let u
  try { u = uitslag(d, i) } catch (e) { t(naam, false, 'gooide een fout: ' + e.message); return }
  for (const [id, ok] of Object.entries(u)) if (!ok) rood.add(id)
  const mis = moetRood.filter((id) => u[id] !== false)
  const teveel = moetGroen.filter((id) => u[id] !== true)
  // Een fout in een enkele aankoop moet ook het eindoordeel over alle drie rood maken.
  const eind = moetRood.length === 0 || verifyAll(d).ok === false
  t(naam, mis.length === 0 && teveel.length === 0 && eind,
    (mis.length ? 'niet rood: ' + mis.join(',') : '') + (teveel.length ? ' niet groen: ' + teveel.join(',') : '') + (eind ? '' : ' eindoordeel bleef goed'))
}

console.log('positieve controle')
const schoon = loadFixtures()
const eerste = verifyAll(schoon)
t('onaangetaste bestanden: alle controles groen', eerste.ok === true)
t('drie aankopen, tien controles per aankoop', eerste.results.length === 3 && eerste.results.every((r) => r.checks.length === 10))
t('tweede run geeft hetzelfde', JSON.stringify(verifyAll(loadFixtures())) === JSON.stringify(eerste))

console.log('de bestanden zelf')
const rawBodies = [1, 2].map((i) => fs.readFileSync(path.join(MAP, 'fixtures', 'purchase-' + (i + 1) + '-body.raw.json')))
t('ruwe bodies bevatten geen regeleinde-teken dat een checkout zou kunnen omzetten', rawBodies.every((b) => !b.includes(13)))
const attr = fs.readFileSync(path.join(MAP, '.gitattributes'), 'utf8')
t('.gitattributes zet de omzetting van regeleinden uit voor de bewijsbestanden', /fixtures\/\*\*\s+-text/.test(attr))
t('aankoop 1 is eerlijk gelabeld als herserialisatie, 2 en 3 als ruw', schoon.purchases.map((p) => p.bodyKind).join(',') === 'jcs-copy,raw,raw')

console.log('wat de pagina over de records zegt, als meting')
for (const p of schoon.purchases) {
  const rc = p.record.record.receipt
  t('aankoop ' + p.n + ': het record verklaart zichzelf onafhankelijk', rc.independence === 'independent')
  t('aankoop ' + p.n + ': onze eigen module kan dat niet bewijzen (LABELS_VERSCHILLEN)', onafhankelijkheid(p.record).staat === 'LABELS_VERSCHILLEN')
  t('aankoop ' + p.n + ': geen menselijke toets uitgevoerd', rc.human_review && rc.human_review.status === 'not-performed')
  t('aankoop ' + p.n + ': het veld validator noemt een model', /\(gpt-[^)]+\)/.test(String(rc.tools && rc.tools.validator)))
}

console.log('geplante fouten in de body')
geval('aankoop 1: een cijfer in netPerCheck gewijzigd', (d) => { d.purchases[0].bodyBytes = Buffer.from(tekst(d.purchases[0].bodyBytes).replace('2639.52', '2639.53')) },
  0, ['deliverable-sha256', 'hash-rule', 'criteria-recomputed', 'verdict'], ['receipt-sha256', 'signature'])
geval('aankoop 2: summary gewijzigd, valt buiten de verkoper-hash', (d) => { d.purchases[1].bodyBytes = Buffer.from(tekst(d.purchases[1].bodyBytes).replace(/"summary":"/, '"summary":"X ')) },
  1, ['deliverable-sha256'], ['hash-rule', 'criteria-recomputed'])
geval('aankoop 3: meta gewijzigd, valt buiten de verkoper-hash', (d) => { d.purchases[2].bodyBytes = Buffer.from(tekst(d.purchases[2].bodyBytes).replace(/"relatedTools"/, '"relatedToolsX"')) },
  2, ['deliverable-sha256'], ['hash-rule'])
geval('aankoop 2: responseHash weggehaald', (d) => { d.purchases[1].bodyBytes = Buffer.from(tekst(d.purchases[1].bodyBytes).replace(/"responseHash"\s*:\s*"[^"]*"\s*,?/, '')) },
  1, ['hash-rule', 'deliverable-sha256'])
geval('aankoop 3: provenance.method gewijzigd', (d) => { d.purchases[2].bodyBytes = Buffer.from(tekst(d.purchases[2].bodyBytes).replace(/"method"\s*:\s*"/, '"method":"X ')) },
  2, ['hash-rule', 'deliverable-sha256'])
geval('aankoop 3: result gewijzigd en de hash door de knutselaar opnieuw uitgerekend', (d) => {
  const b = JSON.parse(tekst(d.purchases[2].bodyBytes))
  b.result.stateTax += 1
  b.provenance.responseHash = responseHashOf(b, d.purchases[2].input)
  d.purchases[2].bodyBytes = Buffer.from(JSON.stringify(b))
}, 2, ['deliverable-sha256', 'criteria-recomputed'], ['hash-rule'])
geval('aankoop 2: het manifest noemt een ander verzoek dan er verstuurd is', (d) => { d.purchases[1].input.salary += 1 },
  1, ['hash-rule'], ['deliverable-sha256', 'receipt-sha256', 'signature'])
// Synthetisch, naar de uitspraak van de verkoper en niet door ons live gekocht: bij een verzoek
// met minder velden vult result.inputs de standaardwaarden aan, terwijl de hash over het
// verzoek zoals verstuurd gaat.
geval('aankoop 1: verzoek met twee velden, result.inputs vult aan, hash over het verzoek zoals verstuurd', (d) => {
  const b = JSON.parse(tekst(d.purchases[0].bodyBytes))
  const verzoek = { salary: b.result.inputs.salary, state: b.result.inputs.state }
  b.provenance.responseHash = responseHashOf(b, verzoek)
  d.purchases[0].input = verzoek
  d.purchases[0].bodyBytes = Buffer.from(JSON.stringify(b))
}, 0, ['deliverable-sha256'], ['hash-rule'])
geval('aankoop 2 en 3 gewisseld', (d) => { const a = d.purchases[1].bodyBytes; d.purchases[1].bodyBytes = d.purchases[2].bodyBytes; d.purchases[2].bodyBytes = a },
  1, ['deliverable-sha256'])
geval('aankoop 2: lege body', (d) => { d.purchases[1].bodyBytes = Buffer.alloc(0) },
  1, ['body-is-json', 'deliverable-sha256', 'hash-rule', 'criteria-recomputed'])
geval('aankoop 1: body afgekapt', (d) => { d.purchases[0].bodyBytes = d.purchases[0].bodyBytes.subarray(0, 1000) },
  0, ['body-is-json', 'deliverable-sha256'])
geval('aankoop 3: een extra lid in result toegevoegd', (d) => { d.purchases[2].bodyBytes = Buffer.from(tekst(d.purchases[2].bodyBytes).replace('"result":{', '"result":{"extra":1,')) },
  2, ['deliverable-sha256', 'hash-rule'])

console.log('geplante fouten in het record')
geval('aankoop 2: een teken van de handtekening gewijzigd', (d) => {
  const s = d.purchases[1].record.record.signature
  s.value = (s.value[0] === 'A' ? 'B' : 'A') + s.value.slice(1)
}, 1, ['signature'], ['receipt-sha256', 'deliverable-sha256'])
geval('aankoop 2: laatste uitslag van pass naar fail', (d) => {
  const r = d.purchases[1].record.record.receipt.results
  r[r.length - 1].result = 'fail'
}, 1, ['receipt-sha256', 'signature', 'criteria-recomputed'])
geval('aankoop 3: laatste uitslag weggehaald', (d) => { d.purchases[2].record.record.receipt.results.pop() },
  2, ['receipt-sha256', 'signature', 'criteria-recomputed'])
geval('aankoop 1: een uitslag dubbel toegevoegd', (d) => { const r = d.purchases[0].record.record.receipt.results; r.push({ ...r[0] }) },
  0, ['receipt-sha256', 'signature'])
geval('aankoop 2: oordeel op fail gezet', (d) => { d.purchases[1].record.record.receipt.verdict = 'fail' },
  1, ['receipt-sha256', 'signature', 'verdict'])
geval('aankoop 3: het bestands-sha256 in het record aangepast', (d) => { d.purchases[2].record.record.receipt.files.remediated.sha256 = '0'.repeat(64) },
  2, ['deliverable-sha256', 'receipt-sha256', 'signature'])
geval('aankoop 2: producent veranderd', (d) => { d.purchases[1].record.record.receipt.parties.producer.key_id = 'eip155:8453:0x0000000000000000000000000000000000000001' },
  1, ['payee', 'receipt-sha256', 'signature'])
geval('aankoop 3: transactie in client_ref veranderd', (d) => { d.purchases[2].record.record.receipt.client_ref = 'x402#2887 purchase 3/3 Base tx 0xdeadbeefdeadbeefdead' },
  2, ['tx-named', 'receipt-sha256', 'signature'])
geval('aankoop 2: het opgegeven aantal bytes in het record gewijzigd', (d) => { d.purchases[1].record.record.receipt.files.remediated.bytes += 1 },
  1, ['deliverable-sha256', 'receipt-sha256', 'signature'])
geval('aankoop 3: alleen het criteria-id in de sidecar gewijzigd', (d) => { d.purchases[2].record.bindings_sidecar.criteria_id = '0'.repeat(64) },
  2, ['criteria-sha256'], ['receipt-sha256', 'signature'])
geval('aankoop 1: alleen de receipt-hash in de sidecar gewijzigd', (d) => { d.purchases[0].record.bindings_sidecar.receipt_sha256 = '0'.repeat(64) },
  0, ['receipt-sha256'], ['signature', 'criteria-sha256'])
geval('aankoop 1: record leeggemaakt', (d) => { d.purchases[0].record = {} },
  0, ['deliverable-sha256', 'criteria-sha256', 'receipt-sha256', 'signature', 'criteria-recomputed', 'verdict', 'payee', 'tx-named'])

console.log('geplante fouten in criteria, sleutels en manifest')
geval('aankoop 2: een teken in het criteria-document gewijzigd', (d) => { d.purchases[1].criteriaBytes = Buffer.from(tekst(d.purchases[1].criteriaBytes).replace('to the cent', 'to the cenT')) },
  1, ['criteria-sha256'], ['receipt-sha256', 'signature'])
geval('gepubliceerde sleutel vervangen door een andere geldige Ed25519-sleutel', (d) => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  d.keys.keys[0].public_key_base64 = raw.toString('base64')
}, 0, ['signature'], ['receipt-sha256'])
geval('sleutellijst leeggemaakt', (d) => { d.keys.keys = [] },
  1, ['signature'])
geval('de sleutel in het record wijkt af van de gepubliceerde', (d) => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519')
  d.purchases[2].record.keys.keys[0].public_key_base64 = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
}, 2, ['signature'])
geval('manifest: verkeerd payTo-adres', (d) => { d.seller.payTo = '0x0000000000000000000000000000000000000001' },
  0, ['payee'], ['signature'])
geval('manifest: een teken van de verwachte receipt-hash gewijzigd', (d) => { const h = d.purchases[0].receiptSha256; d.purchases[0].receiptSha256 = (h[0] === 'a' ? 'b' : 'a') + h.slice(1) },
  0, ['receipt-sha256'], ['signature'])

console.log('randgevallen')
{
  const b = JSON.parse(tekst(schoon.purchases[0].bodyBytes))
  const verzoek = { salary: b.result.inputs.salary, state: b.result.inputs.state }
  b.provenance.responseHash = responseHashOf(b, verzoek)
  t('hash over het verzoek zoals verstuurd, niet over result.inputs', responseHashOf(b, verzoek) === b.provenance.responseHash && responseHashOf(b, b.result.inputs) !== b.provenance.responseHash)
  let gooide = false
  try { responseHashOf(b) } catch { gooide = true }
  t('zonder verzoek weigert de functie te rekenen', gooide)
}
t('geen aankopen: niet goedgekeurd', verifyAll({ seller: schoon.seller, keys: schoon.keys, purchases: [] }).ok === false)
t('elke controle is minstens een keer rood geworden door een geplante fout', [...new Set(eerste.results[0].checks.map((c) => c.id))].every((id) => rood.has(id)),
  'nooit rood geworden: ' + [...new Set(eerste.results[0].checks.map((c) => c.id))].filter((id) => !rood.has(id)).join(','))
t('de JCS-vorm van een bekend voorbeeld klopt (sleutels gesorteerd, geen spaties)', jcs({ b: 1, a: [true, null, 'x'] }) === '{"a":[true,null,"x"],"b":1}')

console.log('')
console.log(goed + ' groen, ' + fout + ' rood')
process.exitCode = fout === 0 ? 0 : 1
