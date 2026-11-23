#!/usr/bin/env node
// Tests the testers. Copies the family to a temporary folder, plants one fault at a time, and checks that the
// matching script fails. A planted fault that does not make anything fail means that script is blind to that kind of fault.
// Faults: remove a vector, change an expected answer, widen what a vector allows, empty the list, truncate the file,
// remove a check from the reference.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending, 2026-11-23.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIR = 'src/settlement-pending/'
const VEC = 'vectors/settlement-pending/vectors.json'
const FILES = [DIR + 'decide.mjs', DIR + 'twins.mjs', DIR + 'run.mjs', DIR + 'table.mjs', DIR + 'properties.mjs', VEC]
const id = (s) => 'x402-settlement-pending-' + s

const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'spv-selftest-'))
  for (const f of FILES) { mkdirSync(dirname(join(d, f)), { recursive: true }); copyFileSync(join(ROOT, f), join(d, f)) }
  return d
}
const edit = (d, f, fn) => {
  const before = readFileSync(join(d, f), 'utf8'), after = fn(before)
  if (after === before) throw new Error(`planting did nothing in ${f}: the fault would not be a fault`)
  writeFileSync(join(d, f), after)
}
const vec = (d, fn) => edit(d, VEC, (t) => { const j = JSON.parse(t); fn(j); return JSON.stringify(j, null, 2) })
const without = (d, ...parts) => vec(d, (j) => { j.vectors = j.vectors.filter((v) => !parts.some((p) => v.id.includes(p))) })
const exits = (d, script) => spawnSync(process.execPath, [DIR + script, '--n=3000'], { cwd: d, encoding: 'utf8', timeout: 120000 }).status
const ref = (d, from, to) => edit(d, DIR + 'decide.mjs', (t) => t.replace(from, to))

const FAULTS = [
  ['remove both vectors for a reverted transaction', 'run.mjs', (d) => without(d, 'reverted-refuse')],
  ['remove both vectors that tell a transfer of another authorization apart', 'run.mjs', (d) => without(d, 'old-payment')],
  ['remove every vector that tells a transfer of another payment apart (decision table)', 'table.mjs', (d) => without(d, 'old-payment', 'other-payer', 'near-miss-payer')],
  ['change an expected answer: wrong recipient now delivers', 'run.mjs', (d) => vec(d, (j) => { j.vectors.find((v) => v.id === id('wrong-recipient-refuse')).expected.outcome = 'DELIVER' })],
  ['widen what a vector allows: wrong token may now be delivered', 'run.mjs', (d) => vec(d, (j) => { j.vectors.find((v) => v.id === id('wrong-token-refuse')).expected.acceptable.push('DELIVER') })],
  ['empty the vector list', 'run.mjs', (d) => vec(d, (j) => { j.vectors = [] })],
  ['truncate vectors.json', 'run.mjs', (d) => edit(d, VEC, (t) => t.slice(0, Math.floor(t.length / 2)))],
  ['reference no longer binds the transfer to this authorization', 'properties.mjs', (d) => ref(d, "    if (lower(t.nonce) !== lower(obs.payment.nonce)) return out('REFUSE', 'R10')\n", '')],
  ['reference no longer binds the transfer to the payer on the proof rail', 'properties.mjs', (d) => ref(d, "    if (!relax.skipPayer && lower(t.from) !== lower(obs.payment.payer)) return out('REFUSE', 'R10')\n", '')],
  ['reference no longer checks the claim (delivers a hash twice)', 'properties.mjs', (d) => ref(d, "  if (!relax.skipClaim && obs.claims && obs.claims.hash === 'delivered') return out('REFUSE', 'R13')\n", '')],
  ['reference no longer checks the token', 'properties.mjs', (d) => ref(d, "  if (!relax.skipToken && lower(t.token) !== lower(obs.quote.asset)) return out('REFUSE', 'R14')\n", '')],
  ['reference no longer refuses a reverted transaction', 'properties.mjs', (d) => ref(d, "return out('REFUSE', 'R04')", "return out('HOLD', 'R04')")],
  ['reference compares amounts as numbers', 'properties.mjs', (d) => ref(d, 'relax.floatAmounts ? BigInt(Number(x))', 'true ? BigInt(Number(x))')],
  ['reference asks for a nonce on the proof rail', 'properties.mjs', (d) => ref(d, "obs.payment.rail === 'proof' && !relax.nonceOnProof", 'false')],
  ['reference takes any non-empty string for a hash', 'properties.mjs', (d) => ref(d, "typeof s === 'string' && HASH.test(s)", '!!s')],
]

let blind = 0
const base = fresh()
for (const s of ['run.mjs', 'table.mjs', 'properties.mjs']) {
  const st = exits(base, s)
  if (st !== 0) { blind++; console.log(`BASELINE FAILS: ${s} exits ${st} on the untouched set`) }
}
rmSync(base, { recursive: true, force: true })
for (const [name, script, plant] of FAULTS) {
  const d = fresh()
  plant(d)
  const st = exits(d, script)
  rmSync(d, { recursive: true, force: true })
  if (st === 0) { blind++; console.log(`BLIND   ${script}: ${name}`) } else console.log(`caught  ${script}: ${name}`)
}
console.log(`planted faults caught: ${FAULTS.length - blind} of ${FAULTS.length}${blind ? ' (' + blind + ' problem(s) above)' : ''}`)
process.exit(blind ? 1 : 0)
