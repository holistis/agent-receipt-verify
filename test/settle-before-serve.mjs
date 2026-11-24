// The settle-before-serve family: vectors/settle-before-serve.
// It freezes vectors.json, checks its hash list, and runs the three scripts of src/settle-before-serve with the numbers they must give:
// 15 vectors (1 open), 8 wrong implementations all caught and none by fewer than 2 vectors, properties that catch all 8 as well,
// and 10 of 10 planted faults caught. No network, no keys. The scripts are run as the commands a reader would run.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { controleerSuiteMap } from '../src/suite-integriteit.mjs'
import { decide } from '../src/settle-before-serve/decide.mjs'

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
t('README names the fingerprint of vectors.json and no other fingerprint', (() => {
  const hex = [...fs.readFileSync(path.join(MAP, 'README.md'), 'utf8').matchAll(/\b[0-9a-f]{12}\b/g)].map((m) => m[0])
  return hex.includes(VINGERAFDRUK.slice(0, 12)) && hex.every((h) => h === VINGERAFDRUK.slice(0, 12))
})())
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
  t('11 defects are planted in an observation that delivers and every one is refused', /invalid observations: refused 11 of 11/.test(r.uit))
}

console.log('')
console.log('selftest.mjs: planted faults')
{
  const r = draai('selftest.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('10 of 10 planted faults are caught', /planted faults caught: 10 of 10/.test(r.uit))
}

console.log('')
console.log('fail closed: an observation that is not well formed throws and never delivers')
{
  const vec = JSON.parse(tekst).vectors
  const basis = () => structuredClone(vec.find((v) => v.expected.delivers === true).input)
  const weigert = (naam, veld, plant) => {
    const o = basis()
    plant(o)
    let melding = ''
    let antwoord
    try { antwoord = decide(o) } catch (e) { melding = String(e.message) }
    t(naam, melding === 'invalid observation: ' + veld && antwoord === undefined, melding || JSON.stringify(antwoord))
  }
  weigert('an unknown facilitator result does not deliver', 'facilitator.result', (o) => { o.facilitator.result = 'maybe' })
  weigert('a latency below zero does not deliver', 'facilitator.latencyMs', (o) => { o.facilitator.latencyMs = -1 })
  weigert('an unknown fallback state does not deliver', 'fallback', (o) => { o.fallback = 'weird' })
  weigert('a header that is not text does not deliver', 'paymentSignature', (o) => { o.paymentSignature = [] })
  weigert('a missing facilitator does not deliver', 'facilitator', (o) => { delete o.facilitator })
  t('the observation they were planted in still delivers', decide(basis()).delivers === true)
  const n = draai('properties.mjs', '--n=100k')
  t('--n=100k is refused with exit 2 and not run as zero situations', n.status === 2)
}

console.log('')
console.log('run.mjs --impl: your own implementation')
{
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-sbs-'))
  try {
    const bron = fs.readFileSync(path.join(wortel, 'src', 'settle-before-serve', 'decide.mjs'), 'utf8')
    const eigen = path.join(map, 'reference.mjs')
    fs.writeFileSync(eigen, bron)
    const stuk = "return out(402, false, false, false, 'S01')"
    if (!bron.includes(stuk)) throw new Error('the mutation cannot be placed')
    const kapot = path.join(map, 'mutant.mjs')
    fs.writeFileSync(kapot, bron.replace(stuk, "return out(200, true, false, false, 'S01')"))
    const a = draai('run.mjs', '--impl', eigen)
    t('the reference as your implementation passes every asserted vector, exit 0', a.status === 0 && /your implementation: 14 of 14 asserted vectors pass, 1 open vectors shown for information/.test(a.uit), 'exit ' + a.status)
    const b = draai('run.mjs', '--impl', kapot)
    t('a copy that delivers without a header fails, exit 1', b.status === 1 && /FAIL  no-header-402/.test(b.uit), 'exit ' + b.status)
    const c = draai('run.mjs', '--impl', path.join(map, 'does-not-exist.mjs'))
    t('a module that cannot be loaded gives exit 2', c.status === 2, 'exit ' + c.status)
    const mini = path.join(map, 'mini.mjs')
    fs.writeFileSync(mini, "export const decide = () => ({ status: 402, delivers: false, callsFacilitator: false, builtBeforeSettle: false })" + String.fromCharCode(10))
    const d = draai('run.mjs', '--impl', mini)
    t('a seller that never delivers fails the vectors that must deliver', d.status === 1 && /FAIL  late-settle-success-200/.test(d.uit), 'exit ' + d.status)
  } finally {
    fs.rmSync(map, { recursive: true, force: true })
  }
}

console.log('')
console.log('settle-before-serve: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
