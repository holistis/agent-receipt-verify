// The settle-before-serve family: vectors/settle-before-serve.
// It freezes vectors.json, checks its hash list, and runs the three scripts of src/settle-before-serve with the numbers they must give:
// 15 vectors (1 open), 8 wrong implementations all caught and none by fewer than 2 vectors, properties that catch all 8 as well,
// and 9 of 9 planted faults caught. No network, no keys. The scripts are run as the commands a reader would run.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { controleerSuiteMap } from '../src/suite-integriteit.mjs'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAP = path.join(wortel, 'vectors', 'settle-before-serve')
const VINGERAFDRUK = '5c115ec59c59e4b2f76e0a9e3c10251218492d4916daf72675eefdf01439a51f'

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}
const sha = (tekst) => crypto.createHash('sha256').update(tekst.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))).digest('hex')
const draai = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join('src', 'settle-before-serve', script), ...args], { cwd: wortel, encoding: 'utf8', timeout: 120000 })
  return { status: r.status, uit: r.stdout || '' }
}

console.log('vectors.json is frozen')
const tekst = fs.readFileSync(path.join(MAP, 'vectors.json'), 'utf8')
t('vectors.json is unchanged (5c115ec59c59)', sha(tekst) === VINGERAFDRUK, sha(tekst).slice(0, 12))
t('CONTROL: a copy with one space added has another hash', sha(tekst + ' ') !== VINGERAFDRUK)
t('15 vectors, 1 of them open', (() => { const v = JSON.parse(tekst).vectors; return v.length === 15 && v.filter((x) => x.asserted === false).length === 1 })())
t('every vector id is unique', (() => { const v = JSON.parse(tekst).vectors.map((x) => x.id); return new Set(v).size === v.length })())
t('SHA256SUMS matches the folder', controleerSuiteMap(MAP).length === 0, controleerSuiteMap(MAP).join(' | '))

console.log('')
console.log('run.mjs: the reference and the wrong implementations')
{
  const r = draai('run.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('reference answers 15 of 15 vectors, 1 recorded as open', /reference: 15 of 15 vectors, 1 recorded as open/.test(r.uit))
  t('all 8 wrong implementations are caught', /wrong twins caught: 8 of 8/.test(r.uit))
  t('none of them rests on a single vector', !/caught by 1 \(fragile\)/.test(r.uit))
}

console.log('')
console.log('properties.mjs: 10 properties over seeded random situations')
{
  const r = draai('properties.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('the reference violates nothing', /reference violations: none/.test(r.uit))
  t('all 8 wrong implementations are caught by the vectors and by the properties', /twins: 8\. caught by both 8, by properties only 0, by vectors only 0, by neither 0/.test(r.uit))
}

console.log('')
console.log('selftest.mjs: planted faults')
{
  const r = draai('selftest.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('9 of 9 planted faults are caught', /planted faults caught: 9 of 9/.test(r.uit))
}

console.log('')
console.log('settle-before-serve: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
