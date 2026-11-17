// Mutatieproef op research/live-paid-call-2026-11-16/reproduce.mjs.
//
// test/live-paid-call.mjs plant fouten in de INVOER en eist dat het script ze ziet. Deze
// proef doet het omgekeerde: ze breekt het SCRIPT zelf, een controle tegelijk, en eist dat
// de test daarop rood wordt. Een controle die je kunt uitzetten zonder dat iemand het merkt,
// controleert niets.
//
//   node test/mutatie-live-paid-call.mjs
//
// Het script wordt na elke mutatie en ook bij een crash teruggezet; aan het eind wordt
// gecontroleerd dat het bestand weer byte voor byte gelijk is aan het begin.
// Draait niet mee in `npm test`, want elke mutatie draait de hele test opnieuw.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORTEL = path.join(HERE, '..')
const DOEL = path.join(WORTEL, 'research', 'live-paid-call-2026-11-16', 'reproduce.mjs')
const origineel = fs.readFileSync(DOEL)
const tekst = origineel.toString('utf8')
const EOL = tekst.includes('\r\n') ? '\r\n' : '\n'
const naarEol = (s) => s.replace(/\r?\n/g, EOL)

// [naam, wat er staat, waardoor het vervangen wordt]
const MUTATIES = [
  ['deliverable-sha256 altijd waar', 'sha256hex(p.bodyBytes) === f.sha256 && Buffer.byteLength(p.bodyBytes) === f.bytes', 'true'],
  ['deliverable: sha-kant weg', 'sha256hex(p.bodyBytes) === f.sha256 && ', ''],
  ['deliverable: lengtecontrole weg', ' && Buffer.byteLength(p.bodyBytes) === f.bytes', ''],
  ['handtekening altijd waar', 'ed25519Verifies(published.public_key_base64, jcs(receipt), p.record.record.signature.value)', 'true'],
  ['handtekening: sleutel-in-record-vergelijking weg', 'published.public_key_base64 === inRecord.public_key_base64 &&', ''],
  ['hash-regel altijd waar', 'responseHashOf(body, p.input) === body.provenance.responseHash', 'true'],
  ['hash-regel neemt result.inputs in plaats van het verzoek', 'inputs: requestInput,', 'inputs: body.result.inputs,'],
  ['hash-regel weigert een ontbrekend verzoek niet meer', "  if (requestInput === undefined) throw new Error('responseHashOf needs the request body that was sent')\n", ''],
  ['hash-regel laat method weg', '    method: body.provenance.method,\n', ''],
  ['hash-regel laat dataVintage weg', '    dataVintage: body.provenance.dataVintage,\n', ''],
  ['hash-regel gebruikt het hele antwoord', 'result: body.result,\n    method', 'result: body,\n    method'],
  ['criteria-sha altijd waar', 'id === receipt.criteria.sha256 && id === sidecar.criteria_id', 'true'],
  ['criteria-sha: sidecar-kant weg', ' && id === sidecar.criteria_id', ''],
  ['receipt-sha altijd waar', 'h === p.receiptSha256 && h === sidecar.receipt_sha256', 'true'],
  ['receipt-sha: sidecar-kant weg', ' && h === sidecar.receipt_sha256', ''],
  ['receipt-sha: manifest-kant weg', 'h === p.receiptSha256 && ', ''],
  ['payee altijd waar', "String(receipt.parties.producer.key_id).toLowerCase() === (data.seller.network + ':' + data.seller.payTo).toLowerCase()", 'true'],
  ['criteria-recomputed altijd waar', 'same && set.criteria.every((c) => mine[c.id] === true)', 'true'],
  ['verdict altijd waar', "receipt.verdict === (allPass ? 'pass' : 'fail') && receipt.verdict === 'pass'", 'true'],
  ['tx-named altijd waar', 'String(receipt.client_ref).toLowerCase().includes(p.tx.slice(0, 18).toLowerCase())', 'true'],
  ['body-is-json altijd waar', "body && typeof body === 'object'", 'true'],
  ['jcs sorteert de sleutels niet meer', 'Object.keys(v).sort().map', 'Object.keys(v).map'],
  ['een lege aankooplijst telt als goed', 'results.length > 0 && results.every', 'results.every'],
  ['alleen de eerste aankoop telt mee voor het eindoordeel', 'results.every((r) => r.checks.every((c) => c.ok))', 'results[0].checks.every((c) => c.ok)'],
]

let levend = 0
try {
  for (const [naam, vanRuw, naarRuw] of MUTATIES) {
    const van = naarEol(vanRuw)
    const naar = naarEol(naarRuw)
    if (!tekst.includes(van)) { console.log('NIET GEVONDEN  ' + naam + ' (het script is veranderd, pas deze lijst aan)'); levend++; continue }
    fs.writeFileSync(DOEL, tekst.replace(van, naar))
    const r = spawnSync(process.execPath, [path.join(HERE, 'live-paid-call.mjs')], { encoding: 'utf8', cwd: WORTEL })
    const gevangen = r.status !== 0
    if (!gevangen) levend++
    console.log((gevangen ? 'gevangen  ' : 'LEEFT     ') + naam)
  }
} finally {
  fs.writeFileSync(DOEL, origineel)
}
const terug = fs.readFileSync(DOEL)
const hersteld = Buffer.compare(terug, origineel) === 0
console.log('\n' + MUTATIES.length + ' mutaties, ' + levend + ' levend, script ' + (hersteld ? 'hersteld' : 'NIET HERSTELD'))
process.exitCode = levend === 0 && hersteld ? 0 : 1
