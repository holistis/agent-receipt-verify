// The settlement-pending family: vectors/settlement-pending (draft 3) and its frozen drafts 2 and 1.
// It freezes the three vectors.json files, checks the three hash lists, and runs the four scripts of src/settlement-pending with the
// numbers they must give: 41 vectors (5 open), 21 wrong implementations all caught, 284 situations and 15 rules, 20 of 20 planted
// faults caught. It also checks that the cross-run README contains the output of the run byte for byte.
// No network, no keys, no Python. The scripts are run as the commands a reader would run.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending, 2026-11-23.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { controleerSuiteMap } from '../src/suite-integriteit.mjs'
import { decide } from '../src/settlement-pending/decide.mjs'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAP = path.join(wortel, 'vectors', 'settlement-pending')
const TWEEDE = path.join(MAP, 'draft-2-frozen')
const EERSTE = path.join(MAP, 'draft-1-frozen')
const CROSS = path.join(MAP, 'cross-run')
const DRAFT3 = '94b07672bfd9be9335d52ac3bedd4f59bc663b30b2978d32f4bfcb1d83c1bbfe'
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
t('draft 3 vectors.json is unchanged (94b07672bfd9)', sha(tekst3) === DRAFT3, sha(tekst3).slice(0, 12))
t('draft 2 vectors.json is unchanged (64568e264272)', sha(tekst2) === DRAFT2, sha(tekst2).slice(0, 12))
t('draft 1 vectors.json is unchanged (fd234a289755)', sha(tekst1) === DRAFT1, sha(tekst1).slice(0, 12))
t('CONTROL: a copy with one space added has another hash', sha(tekst3 + ' ') !== DRAFT3)
t('README names the fingerprint of draft 3 and no fingerprint other than those of the three drafts', (() => {
  const hex = [...fs.readFileSync(path.join(MAP, 'README.md'), 'utf8').matchAll(/\b[0-9a-f]{12}\b/g)].map((m) => m[0])
  const erkend = [DRAFT3, DRAFT2, DRAFT1].map((h) => h.slice(0, 12))
  return hex.includes(DRAFT3.slice(0, 12)) && hex.every((h) => erkend.includes(h))
})())
t('draft 3 has 41 vectors, 5 of them open; draft 2 has 26 with 3 open; draft 1 has 17 with 1 open', (() => {
  const a = JSON.parse(tekst3).vectors, b = JSON.parse(tekst2).vectors, c = JSON.parse(tekst1).vectors
  const open = (x) => x.filter((v) => v.asserted === false).length
  return a.length === 41 && open(a) === 5 && b.length === 26 && open(b) === 3 && c.length === 17 && open(c) === 1
})())
t('SHA256SUMS of draft 3 matches the folder', controleerSuiteMap(MAP).length === 0, controleerSuiteMap(MAP).join(' | '))
t('SHA256SUMS of draft 2 matches its folder', controleerSuiteMap(TWEEDE).length === 0, controleerSuiteMap(TWEEDE).join(' | '))
t('SHA256SUMS of draft 1 matches its folder', controleerSuiteMap(EERSTE).length === 0, controleerSuiteMap(EERSTE).join(' | '))

console.log('')
console.log('run.mjs: the reference and the wrong implementations')
{
  const r = draai('run.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('reference answers 41 of 41 vectors, 5 recorded as open, 14 allow more than one answer', /reference: 41 of 41 vectors, 5 recorded as open, 14 allow more than one answer/.test(r.uit))
  t('all 21 wrong implementations are caught', /wrong twins caught: 21 of 21/.test(r.uit))
  t('none of them rests on a single vector', !/fragile/.test(r.uit) && /vectors that are the only catcher of some twin: 0 of 36/.test(r.uit))
}

console.log('')
console.log('table.mjs: the decision table')
{
  const r = draai('table.mjs', '--check')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('284 situations in the grid, all answered', /situations in the grid: 284, answered by the reference: 284/.test(r.uit))
  t('15 rules, every one reached by a vector', (r.uit.match(/^R\d\d \| \d+ \| [1-9]\d*$/gm) || []).length === 15)
  t('R12 and R13 have a vector on every way a hash is adopted and on every rail', /R12: a vector on every way in \(3\)/.test(r.uit) && /R13: a vector on every way in \(3\)/.test(r.uit))
  t('decision-table.md matches the grid and the vectors', /decision-table.md matches the grid and the vectors/.test(r.uit))
}

console.log('')
console.log('properties.mjs: 12 properties over seeded random situations')
{
  const r = draai('properties.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('the reference violates nothing', /reference violations: none/.test(r.uit))
  t('all 21 wrong implementations are caught by the vectors and by the properties', /twins: 21\. caught by both 21, by properties only 0, by vectors only 0, by neither 0/.test(r.uit))
  t('12 properties are listed', (r.uit.match(/^ P\d+ /gm) || []).length === 12)
  t('23 defects are planted in an observation that delivers and every one is refused', /invalid observations: refused 23 of 23; a missing claims object counts as none and still delivers: yes/.test(r.uit))
}

console.log('')
console.log('selftest.mjs: planted faults')
{
  const r = draai('selftest.mjs')
  t('exit 0', r.status === 0, 'exit ' + r.status)
  t('20 of 20 planted faults are caught', /planted faults caught: 20 of 20/.test(r.uit))
}

console.log('')
console.log('fail closed: an observation that is not well formed throws and never delivers')
{
  const vec = JSON.parse(tekst3).vectors
  const basis = (id) => structuredClone(vec.find((v) => v.id === 'x402-settlement-pending-' + id).input)
  const weigert = (naam, veld, plant) => {
    const o = basis('boolean-lies')
    plant(o)
    let melding = ''
    let antwoord
    try { antwoord = decide(o) } catch (e) { melding = String(e.message) }
    t(naam, melding === 'invalid observation: ' + veld && antwoord === undefined, melding || JSON.stringify(antwoord))
  }
  weigert('an unknown claim status does not deliver', 'claims.hash', (o) => { o.claims = { hash: 'claimed' } })
  weigert('an unknown rail does not deliver', 'payment.rail', (o) => { o.payment.rail = 'lightning' })
  weigert('a price that is an empty string does not deliver', 'quote.price', (o) => { o.quote.price = '' })
  weigert('an amount that is not a string of digits does not deliver', 'chain.transfer.amount', (o) => { o.chain.transfer.amount = '+10000' })
  weigert('a chain state that nobody knows does not deliver', 'chain.receipt', (o) => { o.chain.receipt = 'DEEP' })
  weigert('a recipient that is missing on both sides does not deliver', 'quote.payTo', (o) => { delete o.quote.payTo; delete o.chain.transfer.to })
  weigert('a nonce that is missing on both sides does not deliver', 'payment.nonce', (o) => { delete o.payment.nonce; delete o.chain.transfer.nonce })
  const zonder = basis('boolean-lies')
  delete zonder.claims
  t('a missing claims object counts as none and still delivers', decide(zonder).outcome === 'DELIVER')
  const n = draai('properties.mjs', '--n=100k')
  t('--n=100k is refused with exit 2 and not run as zero situations', n.status === 2)
}

console.log('')
console.log('run.mjs --impl: your own implementation')
{
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-sp-'))
  try {
    const bron = fs.readFileSync(path.join(wortel, 'src', 'settlement-pending', 'decide.mjs'), 'utf8')
    const eigen = path.join(map, 'reference.mjs')
    fs.writeFileSync(eigen, bron)
    const stuk = "return out('REFUSE', 'R14')"
    if (!bron.includes(stuk)) throw new Error('the mutation cannot be placed')
    const kapot = path.join(map, 'mutant.mjs')
    fs.writeFileSync(kapot, bron.replace(stuk, "return out('DELIVER', 'R12')"))
    const a = draai('run.mjs', '--impl', eigen)
    t('the reference as your implementation passes every asserted vector, exit 0', a.status === 0 && /your implementation: 36 of 36 asserted vectors pass, 5 open vectors shown for information/.test(a.uit), 'exit ' + a.status)
    const b = draai('run.mjs', '--impl', kapot)
    t('a copy that delivers on another token fails, exit 1', b.status === 1 && /FAIL  wrong-token-refuse/.test(b.uit), 'exit ' + b.status)
    const c = draai('run.mjs', '--impl', path.join(map, 'does-not-exist.mjs'))
    t('a module that cannot be loaded gives exit 2', c.status === 2, 'exit ' + c.status)
    const mini = path.join(map, 'mini.mjs')
    fs.writeFileSync(mini, "export const decide = () => ({ outcome: 'REFUSE' })" + String.fromCharCode(10))
    const d = draai('run.mjs', '--impl', mini)
    t('an answer without secondSettle counts as false; a seller that only refuses fails the vectors that deliver', d.status === 1 && /FAIL  boolean-lies/.test(d.uit) && /pass  wrong-recipient-refuse/.test(d.uit), 'exit ' + d.status)
  } finally {
    fs.rmSync(map, { recursive: true, force: true })
  }
}

console.log('')
console.log('cross-run: the README holds the recorded output')
{
  const uitvoer = lf(fs.readFileSync(path.join(CROSS, 'uitvoer.txt'), 'utf8')).replace(/\n+$/, '')
  const readme = lf(fs.readFileSync(path.join(CROSS, 'README.md'), 'utf8'))
  t('README.md contains uitvoer.txt byte for byte', readme.includes(uitvoer))
  t('the output names the gist file hash and Python 3.12', /sha256 d76537a70102c639/.test(uitvoer) && /python: 3\.12\./.test(uitvoer))
  t('the output covers all 41 vectors of draft 3', /vectors: 41, asserted 36, open 5/.test(uitvoer))
  t('no difference is left without an explanation', /without an explanation in this adapter: 0/.test(uitvoer))
  t('the adapter does not copy the gist into the repository', !fs.existsSync(path.join(CROSS, 'test_settlement_pending_chain_before_delivery.py')))
  const py = fs.readFileSync(path.join(CROSS, 'kruisrun.py'), 'utf8')
  t('the adapter imports no file, process or network module', !/^\s*(import|from)\s+(os|subprocess|socket|urllib|http|requests|shutil)\b/m.test(py))
  t('the adapter can pin the gist file by its hash and exits 2 on another hash', /--sha256/.test(py) && /sys\.exit\(2\)/.test(py) && /does not run|was not run/.test(py))
  t('the adapter warns that it runs the file it is given', /WARNING: this runs the file you gave it/.test(py))
  t('the adapter prints started with -I only when Python was started with -I', /sys\.flags\.isolated/.test(py) && /not started with -I/.test(py))
  t('the adapter calls a difference outside and not DIFFERS', /'differs': 'outside'/.test(py) && !/DIFFERS/.test(py) && !/DIFFERS/.test(uitvoer))
  t('the output of the run names the gist file hash that the README gives', /sha256 d76537a70102c6399deb9b8be9e8ceae3a90728e2e7d6004cef5840edc4b524e/.test(uitvoer) && readme.includes('d76537a70102c6399deb9b8be9e8ceae3a90728e2e7d6004cef5840edc4b524e'))
  const live = [path.join(MAP, 'README.md'), path.join(CROSS, 'README.md'), path.join(MAP, 'vectors.json'), path.join(CROSS, 'uitvoer.txt')].map((p) => fs.readFileSync(p, 'utf8')).join(String.fromCharCode(10))
  t('nothing in the live files states a licence for the gist or quotes a message about it', !/\bMIT\b/.test(live) && !/runnable, standard library only/.test(live))
  t('no live file dates a message from the community Slack or gives a status code from it', !/Slack message of|Slack messages of|\b401\b/.test(live))
}

console.log('')
console.log('settlement-pending: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
