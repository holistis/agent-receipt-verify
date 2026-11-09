// Separate, deliberately NOT merged into test/attempt-identity.mjs — see the top comment of
// src/facilitator-request-binding.mjs for why. Runs no network, needs no account, and reads
// no live facilitator; every vector is a model of the published @x402/core, @x402/express and
// @x402/mcp 2.30.0 source, pinned by exact file:line citations in the vectors themselves.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toetsFacilitatorBinding } from '../src/facilitator-request-binding.mjs'

const hier = path.dirname(fileURLToPath(import.meta.url))
const vectorMap = path.join(hier, '..', 'vectors', 'facilitator-request-binding')

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

console.log('elke vector op schijf wordt echt gedraaid')
// Deze map bevat ook niet-vector .json-bestanden (bv. prevalence-scan-summary.json, een
// meetresultaat, geen vector) -- lees de map niet blind als "elk .json-bestand is een vector",
// dat liet deze test eerder crashen op een bestand zonder request_a/request_b/claim. Een
// bestand zonder die drie velden is expliciet geen vector en wordt overgeslagen, zichtbaar
// gelogd, niet stil.
const alleJson = fs.readdirSync(vectorMap).filter((b) => b.endsWith('.json')).sort()
const bestanden = []
for (const b of alleJson) {
  const v = JSON.parse(fs.readFileSync(path.join(vectorMap, b), 'utf8'))
  if (v && v.request_a && v.request_b && v.claim) bestanden.push(b)
  else console.log('  overgeslagen (geen vector-vorm): ' + b)
}
t('er staan vectoren op schijf', bestanden.length >= 7, String(bestanden.length))

const claims = { collapses: 0, distinguished: 0 }
for (const b of bestanden) {
  const v = JSON.parse(fs.readFileSync(path.join(vectorMap, b), 'utf8'))
  const u = toetsFacilitatorBinding(v)
  t(b + ': ' + v.claim, u.outcome === 'PASS', JSON.stringify({ identical: u.identical }))
  if (v.claim === 'collapses-to-same-message') claims.collapses++
  else claims.distinguished++
}

console.log('')
console.log('dekking: zowel een collapse als een onderscheiden geval staat erin, geen eenzijdige set')
t('minstens een vector toont een collapse', claims.collapses >= 1, String(claims.collapses))
t('minstens een vector toont een onderscheiden geval', claims.distinguished >= 1, String(claims.distinguished))

console.log('')
console.log('facilitator-request-binding: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
