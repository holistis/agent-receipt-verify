// The settlement-pending family: vectors/settlement-pending (draft 3) and its frozen drafts 2 and 1.
// It freezes the three vectors.json files, checks the three hash lists, and runs the four scripts of src/settlement-pending with the
// numbers they must give: 39 vectors (5 open), 20 wrong implementations all caught, 284 situations and 15 rules, 15 of 15 planted
// faults caught. It also checks that the cross-run README contains the output of the run byte for byte.
// No network, no keys, no Python. The scripts are run as the commands a reader would run.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending, 2026-11-23.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { controleerSuiteMap } from '../src/suite-integriteit.mjs'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAP = path.join(wortel, 'vectors', 'settlement-pending')
const TWEEDE = path.join(MAP, 'draft-2-frozen')
const EERSTE = path.join(MAP, 'draft-1-frozen')
const CROSS = path.join(MAP, 'cross-run')
const DRAFT3 = 'e59fd5017b322be96582842d6b47a1d82157194ad2c5ac7ce90140aa45c6ba0e'
const DRAFT2 = '64568e264272738357d6a456265c20fac8a70c0768a4ccf4630f743e24ff9ae2'
const DRAFT1 = 'fd234a28975569089227a19b3fb330f03e7794a5b45b1feec2a78cc4ff701270'

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}
const CR = String.fromCharCode(13), LF = String.fromCharCode(10)
const lf = (tekst) => tekst.split(CR + LF).join(LF)
const sha = (tekst) => crypto.createHash('sha256').update(lf(tekst)).digest('hex')
const draai = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join('src', 'settlement-pending', script), ...args], { cwd: wortel, encoding: 'utf8', timeout: 120000 })
  return { status: r.status, uit: r.stdout || '' }
}

console.log('the three vectors.json files are frozen')
const tekst3 = fs.readFileSync(path.join(MAP, 'vectors.json'), 'utf8')
const tekst2 = fs.readFileSync(path.join(TWEEDE, 'vectors.json'), 'utf8')
const tekst1 = fs.readFileSync(path.join(EERSTE, 'vectors.json'), 'utf8')
t('draft 3 vectors.json is unchanged (e59fd5017b32)', sha(tekst3) === DRAFT3, sha(tekst3).slice(0, 12))
t('draft 2 vectors.json is unchanged (64568e264272)', sha(tekst2) === DRAFT2, sha(tekst2).slice(0, 12))
t('draft 1 vectors.json is unchanged (fd234a289755)', sha(tekst1) === DRAFT1, sha(tekst1).slice(0, 12))
t('CONTROL: a copy with one space added has another hash', sha(tekst3 + ' ') !== DRAFT3)
t('draft 3 has 39 vectors, 5 of them open; draft 2 has 26 with 3 open; draft 1 has 17 with 1 open', (() => {
  const a = JSON.parse(tekst3).vectors, b = JSON.parse(tekst2).vectors, c = JSON.parse(tekst1).vectors
  const open = (x) => x.filter((v) => v.asserted === false).length
  return a.length === 39 && open(a) === 5 && b.length === 26 && open(b) === 3 && c.length === 17 && open(c) === 1
})())
t('SHA256SUMS of draft 3 matches the folder', controleerSuiteMap(MAP).length === 0, controleerSuiteMap(MAP).join(' | '))
t('SHA256SUMS of draft 2 matches its folder', controleerSuiteMap(TWEEDE).length === 0, controleerSuiteMap(TWEEDE).join(' | '))
t('SHA256SUMS of draft 1 matches its folder', controleerSuiteMap(EERSTE).length === 0, controleerSuiteMap(EERSTE).join(' | '))

console.log('')
console.log('run.mjs: the reference and the wrong implementations')
{
  const r = draai('run.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('reference answers 39 of 39 vectors, 5 recorded as open, 14 allow more than one answer', /reference: 39 of 39 vectors, 5 recorded as open, 14 allow more than one answer/.test(r.uit))
  t('all 20 wrong implementations are caught', /wrong twins caught: 20 of 20/.test(r.uit))
  t('none of them rests on a single vector', !/fragile/.test(r.uit) && /vectors that are the only catcher of some twin: 0 of 34/.test(r.uit))
}

console.log('')
console.log('table.mjs: the decision table')
{
  const r = draai('table.mjs', '--check')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('284 situations in the grid, all answered', /situations in the grid: 284, answered by the reference: 284/.test(r.uit))
  t('15 rules, every one reached by a vector', (r.uit.match(/^R\d\d \| \d+ \| [1-9]\d*$/gm) || []).length === 15)
  t('decision-table.md matches the grid and the vectors', /decision-table.md matches the grid and the vectors/.test(r.uit))
}

console.log('')
console.log('properties.mjs: 12 properties over seeded random situations')
{
  const r = draai('properties.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('the reference violates nothing', /reference violations: none/.test(r.uit))
  t('all 20 wrong implementations are caught by the vectors and by the properties', /twins: 20\. caught by both 20, by properties only 0, by vectors only 0, by neither 0/.test(r.uit))
  t('12 properties are listed', (r.uit.match(/^ P\d+ /gm) || []).length === 12)
}

console.log('')
console.log('selftest.mjs: planted faults')
{
  const r = draai('selftest.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('15 of 15 planted faults are caught', /planted faults caught: 15 of 15/.test(r.uit))
}

console.log('')
console.log('cross-run: the README holds the recorded output')
{
  const uitvoer = lf(fs.readFileSync(path.join(CROSS, 'uitvoer.txt'), 'utf8')).replace(/\n+$/, '')
  const readme = lf(fs.readFileSync(path.join(CROSS, 'README.md'), 'utf8'))
  t('README.md contains uitvoer.txt byte for byte', readme.includes(uitvoer))
  t('the output names the gist file hash and Python 3.12', /sha256 b432d082c1d79bb4/.test(uitvoer) && /python: 3\.12\./.test(uitvoer))
  t('the output covers all 39 vectors of draft 3', /vectors: 39, asserted 34, open 5/.test(uitvoer))
  t('no difference is left without an explanation', /without an explanation in this adapter: 0/.test(uitvoer))
  t('the adapter does not copy the gist into the repository', !fs.existsSync(path.join(CROSS, 'test_settlement_pending_chain_before_delivery.py')))
  t('the adapter imports no file, process or network module', !/^\s*(import|from)\s+(os|subprocess|socket|urllib|http|requests|shutil)\b/m.test(fs.readFileSync(path.join(CROSS, 'kruisrun.py'), 'utf8')))
}

console.log('')
console.log('settlement-pending: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
