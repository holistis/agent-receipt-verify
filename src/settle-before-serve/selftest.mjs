#!/usr/bin/env node
// Tests the testers. Copies the family to a temporary folder, plants one fault at a time, and checks that the
// matching script fails. A planted fault that does not make anything fail means that script is blind to that kind of fault.
// Faults: remove vectors, change an expected answer, empty the list, truncate the file, break the reference.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIR = 'src/settle-before-serve/'
const VEC = 'vectors/settle-before-serve/vectors.json'
const FILES = [DIR + 'decide.mjs', DIR + 'twins.mjs', DIR + 'run.mjs', DIR + 'properties.mjs', VEC]
const id = (s) => 'x402-settle-before-serve-' + s

const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'sbs-selftest-'))
  for (const f of FILES) { mkdirSync(dirname(join(d, f)), { recursive: true }); copyFileSync(join(ROOT, f), join(d, f)) }
  return d
}
const edit = (d, f, fn) => {
  const before = readFileSync(join(d, f), 'utf8'), after = fn(before)
  if (after === before) throw new Error(`planting did nothing in ${f}: the fault would not be a fault`)
  writeFileSync(join(d, f), after)
}
const vec = (d, fn) => edit(d, VEC, (t) => { const j = JSON.parse(t); fn(j); return JSON.stringify(j, null, 2) })
const exits = (d, script) => spawnSync(process.execPath, [DIR + script, '--n=2000'], { cwd: d, encoding: 'utf8', timeout: 120000 }).status
const without = (pred) => (d) => vec(d, (j) => { j.vectors = j.vectors.filter((v) => !pred(v.id.replace(id(''), ''))) })

const FAULTS = [
  ['remove the three vectors with a slow settle (the race rows)', 'run.mjs', without((n) => n.startsWith('late-settle') || n === 'settle-unknown-timeout-402')],
  ['remove the four vectors with an unparseable header (row A)', 'run.mjs', without((n) => n.startsWith('junk-header'))],
  ['remove the five vectors where nothing confirms (rows B, C and the late failure)', 'run.mjs', without((n) => ['forged-signature-402', 'settle-failed-logged-only-402', 'settle-unknown-timeout-402', 'both-paths-fail-402', 'late-settle-failure-402'].includes(n))],
  ['change an expected answer: a junk header now delivers', 'run.mjs', (d) => vec(d, (j) => { const e = j.vectors.find((v) => v.id === id('junk-header-400')).expected; e.status = 200; e.delivers = true })],
  ['empty the vector list', 'run.mjs', (d) => vec(d, (j) => { j.vectors = [] })],
  ['truncate vectors.json', 'run.mjs', (d) => edit(d, VEC, (t) => t.slice(0, Math.floor(t.length / 2)))],
  ['reference delivers on an unparseable header', 'properties.mjs', (d) => edit(d, DIR + 'decide.mjs', (t) => t.replace("return out(relax.unparseableAs402 ? 402 : 400, false, !!relax.facilitatorFirst, false, 'S02')", "return out(200, true, false, false, 'S02')"))],
  ['reference delivers when nothing confirms', 'properties.mjs', (d) => edit(d, DIR + 'decide.mjs', (t) => t.replace("return out(402, false, true, false, 'S05')\n}", "return out(200, true, true, false, 'S05')\n}"))],
  ['reference builds the data before the settle result is in', 'properties.mjs', (d) => edit(d, DIR + 'decide.mjs', (t) => t.replace("(relax.errorIsSuccess && f === 'error')) return out(200, true, true, false, 'S03')", "(relax.errorIsSuccess && f === 'error')) return out(200, true, true, true, 'S03')"))],
]

let blind = 0
const base = fresh()
for (const s of ['run.mjs', 'properties.mjs']) {
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
