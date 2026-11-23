// The settlement-pending family: vectors/settlement-pending (draft 2) and its frozen draft 1.
// It freezes both vectors.json files, checks both hash lists, and runs the four scripts of src/settlement-pending with the numbers
// they must give: 26 vectors (3 open), 15 wrong implementations all caught, 196 situations and 12 rules, 9 of 9 planted faults caught.
// No network, no keys. The scripts are run as the commands a reader would run.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending, 2026-11-23.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { controleerSuiteMap } from '../src/suite-integriteit.mjs'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAP = path.join(wortel, 'vectors', 'settlement-pending')
const EERSTE = path.join(MAP, 'draft-1-frozen')
const DRAFT2 = '64568e264272738357d6a456265c20fac8a70c0768a4ccf4630f743e24ff9ae2'
const DRAFT1 = 'fd234a28975569089227a19b3fb330f03e7794a5b45b1feec2a78cc4ff701270'

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}
const sha = (tekst) => crypto.createHash('sha256').update(tekst.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))).digest('hex')
const draai = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join('src', 'settlement-pending', script), ...args], { cwd: wortel, encoding: 'utf8', timeout: 120000 })
  return { status: r.status, uit: r.stdout || '' }
}

console.log('both vectors.json files are frozen')
const tekst2 = fs.readFileSync(path.join(MAP, 'vectors.json'), 'utf8')
const tekst1 = fs.readFileSync(path.join(EERSTE, 'vectors.json'), 'utf8')
t('draft 2 vectors.json is unchanged (64568e264272)', sha(tekst2) === DRAFT2, sha(tekst2).slice(0, 12))
t('draft 1 vectors.json is unchanged (fd234a289755)', sha(tekst1) === DRAFT1, sha(tekst1).slice(0, 12))
t('CONTROL: a copy with one space added has another hash', sha(tekst2 + ' ') !== DRAFT2)
t('draft 2 has 26 vectors, 3 of them open, and draft 1 has 17 with 1 open', (() => {
  const a = JSON.parse(tekst2).vectors, b = JSON.parse(tekst1).vectors
  return a.length === 26 && a.filter((v) => v.asserted === false).length === 3 && b.length === 17 && b.filter((v) => v.asserted === false).length === 1
})())
t('SHA256SUMS of draft 2 matches the folder', controleerSuiteMap(MAP).length === 0, controleerSuiteMap(MAP).join(' | '))
t('SHA256SUMS of draft 1 matches its folder', controleerSuiteMap(EERSTE).length === 0, controleerSuiteMap(EERSTE).join(' | '))

console.log('')
console.log('run.mjs: the reference and the wrong implementations')
{
  const r = draai('run.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('reference answers 26 of 26 vectors, 3 recorded as open', /reference: 26 of 26 vectors, 3 recorded as open/.test(r.uit))
  t('all 15 wrong implementations are caught', /wrong twins caught: 15 of 15/.test(r.uit))
  t('the two single-catcher vectors are named', /vectors that are the only catcher of some twin: 2 of 23/.test(r.uit))
}

console.log('')
console.log('table.mjs: the decision table')
{
  const r = draai('table.mjs', '--check')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('196 situations in the grid, all answered', /situations in the grid: 196, answered by the reference: 196/.test(r.uit))
  t('12 rules, every one reached by a vector', (r.uit.match(/^R\d\d \| \d+ \| [1-9]\d*$/gm) || []).length === 12)
  t('decision-table.md matches the grid and the vectors', /decision-table.md matches the grid and the vectors/.test(r.uit))
}

console.log('')
console.log('properties.mjs: 11 properties over seeded random situations')
{
  const r = draai('properties.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('the reference violates nothing', /reference violations: none/.test(r.uit))
  t('all 15 wrong implementations are caught by the vectors and by the properties', /twins: 15\. caught by both 15, by properties only 0, by vectors only 0, by neither 0/.test(r.uit))
}

console.log('')
console.log('selftest.mjs: planted faults')
{
  const r = draai('selftest.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('9 of 9 planted faults are caught', /planted faults caught: 9 of 9/.test(r.uit))
}

console.log('')
console.log('settlement-pending: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
