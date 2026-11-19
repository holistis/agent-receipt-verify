// Tests the tester: vectors/nirium-verify-audit-cid/run.mjs and the suite around it. The expected results in the vectors come from running
// the real nirium-protocol/nirium code (see the README there); that cannot run here, so this test checks the part we own:
// the runner must FAIL when the verifier is wrong, when it throws, when a vector is removed, added, changed, truncated or emptied,
// when SHA256SUMS is missing, empty or duplicated, and it must still PASS on a Windows checkout with CRLF line endings.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SUITE = path.join(wortel, 'vectors', 'nirium-verify-audit-cid')
let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nirium-vec-'))
const origineel = fs.readdirSync(SUITE).filter((f) => f.endsWith('.json')).sort().map((f) => ({ f, v: JSON.parse(fs.readFileSync(path.join(SUITE, f), 'utf8')) }))

// a stand-in verifier that answers from the ORIGINAL suite, so a damaged copy of the suite meets an honest verifier
const stub = path.join(tmp, 'stub.mjs')
fs.writeFileSync(stub, `
import fs from 'node:fs'
const dir = process.env.SUITE_ORIG
const kaart = new Map()
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) { const v = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')); kaart.set(JSON.stringify(v.document), v) }
export function verifyAuditDocument(doc) {
  const v = kaart.get(JSON.stringify(doc))
  if (!v) throw new Error('unknown document')
  const [modus, id] = (process.env.MODE || '').split(':')
  if (modus === 'gooi' && id === v.id) throw new Error('boom')
  const r = { ...v.expected }
  if (modus === 'omdraaien' && id === v.id) r.ok = !r.ok
  if (modus === 'failopen' && ['hash-only-made-up-hash-no-agent', 'hash-only-signature-removed', 'hash-only-agent-removed'].includes(v.id)) r.ok = true
  return r
}
`)
const leeg = path.join(tmp, 'leeg.mjs')
fs.writeFileSync(leeg, 'export const iets = 1\n')

const hash = (buf) => {
  const uit = []
  for (let i = 0; i < buf.length; i++) if (!(buf[i] === 13 && buf[i + 1] === 10)) uit.push(buf[i])
  return crypto.createHash('sha256').update(Buffer.from(uit)).digest('hex')
}
function sums(d) {
  const lijst = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort()
  fs.writeFileSync(path.join(d, 'SHA256SUMS'), lijst.map((f) => hash(fs.readFileSync(path.join(d, f))) + '  ' + f).join('\n') + '\n')
}
let teller = 0
function kopie() {
  const d = path.join(tmp, 'kopie' + ++teller)
  fs.mkdirSync(d)
  for (const f of fs.readdirSync(SUITE)) if (f.endsWith('.json') || f === 'SHA256SUMS' || f === 'run.mjs') fs.copyFileSync(path.join(SUITE, f), path.join(d, f))
  return d
}
function draai(d, module = stub, extra = [], mode = '') {
  const r = spawnSync(process.execPath, [path.join(d, 'run.mjs'), module, ...extra], { encoding: 'utf8', env: { ...process.env, SUITE_ORIG: SUITE, MODE: mode } })
  return { code: r.status, uit: (r.stdout || '') + (r.stderr || '') }
}
const regels = (uit, begin) => uit.split('\n').filter((l) => l.trim().startsWith(begin))
const eerste = origineel[0]

console.log('the suite itself')
const perSoort = {}
for (const { v } of origineel) perSoort[v.kind] = (perSoort[v.kind] || 0) + 1
t('21 vectors: 2 accept, 14 reject, 5 accept-by-design', origineel.length === 21 && perSoort.accept === 2 && perSoort.reject === 14 && perSoort['accept-by-design'] === 5, JSON.stringify(perSoort))
t('ids are unique and every expected has the four result fields', new Set(origineel.map((x) => x.v.id)).size === 21 && origineel.every((x) => ['ok', 'hashMatch', 'hashOnly', 'signatureStatus'].every((k) => k in x.v.expected)))
t('every vector names who wrote it and when', origineel.every((x) => x.v.source && x.v.source.by === 'github.com/holistis' && /^2026-11-19$/.test(x.v.source.date)))
t('the README carries the Cite as line', /^Cite as: github\.com\/holistis\//m.test(fs.readFileSync(path.join(SUITE, 'README.md'), 'utf8')))

console.log('the runner against verifiers')
let r = draai(SUITE, stub, ['--expect=21'])
t('an honest verifier passes all 21 and exits 0', r.code === 0 && /21 vectors, 21 pass, 0 fail, 0 problem/.test(r.uit) && /^OK$/m.test(r.uit), r.uit.slice(-200))
r = draai(SUITE, stub, ['--expect=20'])
t('--expect=20 fails on 21 vectors', r.code === 1 && /expected 20 vectors, found 21/.test(r.uit))
r = draai(SUITE, stub, [], 'omdraaien:' + eerste.v.id)
t('one flipped answer fails exactly that vector', r.code === 1 && regels(r.uit, 'FAIL ').length === 1 && r.uit.includes('FAIL  ' + eerste.v.id), r.uit.slice(-200))
r = draai(SUITE, stub, [], 'gooi:' + eerste.v.id)
t('a verifier that throws is a FAIL line, not a crash', r.code === 1 && /the verifier threw: boom/.test(r.uit) && !/\n\s+at /.test(r.uit))
r = draai(SUITE, stub, [], 'failopen:x')
const failopen = regels(r.uit, 'FAIL  ').map((l) => l.trim().split(/\s+/)[1])
t('the old fail-open behaviour fails exactly the three hash-only rejects', r.code === 1 && failopen.length === 3 && failopen.every((i) => i.startsWith('hash-only-')), failopen.join(','))
r = draai(SUITE, leeg)
t('a module without the export fails with a clear message', r.code === 1 && /no function export named verifyAuditDocument/.test(r.uit))
r = draai(SUITE, path.join(tmp, 'bestaat-niet.mjs'))
t('a module that cannot be imported fails with a clear message', r.code === 1 && /cannot import the module/.test(r.uit))

console.log('the suite damaged in every way we know')
let d = kopie(); fs.rmSync(path.join(d, eerste.f)); r = draai(d)
t('a vector removed (SHA256SUMS kept)', r.code === 1 && /listed in SHA256SUMS but missing/.test(r.uit))
d = kopie(); fs.writeFileSync(path.join(d, '99-extra.json'), JSON.stringify({ ...eerste.v, id: 'extra' })); r = draai(d)
t('an extra vector that SHA256SUMS does not list', r.code === 1 && /vector not in SHA256SUMS: 99-extra\.json/.test(r.uit))
d = kopie(); fs.appendFileSync(path.join(d, eerste.f), ' '); r = draai(d)
t('one byte changed in a vector', r.code === 1 && /vector changed, hash differs/.test(r.uit))
d = kopie(); { const b = fs.readFileSync(path.join(d, eerste.f)); fs.writeFileSync(path.join(d, eerste.f), b.subarray(0, Math.floor(b.length / 2))) } r = draai(d)
t('a vector cut in half', r.code === 1 && /hash differs/.test(r.uit) && /not valid JSON/.test(r.uit))
d = kopie(); fs.rmSync(path.join(d, 'SHA256SUMS')); r = draai(d)
t('SHA256SUMS missing', r.code === 1 && /SHA256SUMS is missing/.test(r.uit))
d = kopie(); fs.writeFileSync(path.join(d, 'SHA256SUMS'), ''); r = draai(d)
t('SHA256SUMS empty', r.code === 1 && /lists no vectors/.test(r.uit))
d = kopie(); { const s = fs.readFileSync(path.join(d, 'SHA256SUMS'), 'utf8'); fs.writeFileSync(path.join(d, 'SHA256SUMS'), s + s.split('\n')[0] + '\n') } r = draai(d)
t('a duplicated line in SHA256SUMS', r.code === 1 && /duplicate line in SHA256SUMS/.test(r.uit))
d = kopie(); fs.writeFileSync(path.join(d, 'SHA256SUMS'), fs.readFileSync(path.join(d, 'SHA256SUMS'), 'utf8') + 'not a hash line\n'); r = draai(d)
t('an unreadable line in SHA256SUMS', r.code === 1 && /unreadable line in SHA256SUMS/.test(r.uit))
d = kopie(); fs.rmSync(path.join(d, 'SHA256SUMS')); for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) fs.rmSync(path.join(d, f)); r = draai(d)
t('an empty suite folder', r.code === 1 && /no vectors found/.test(r.uit))

console.log('an attacker who keeps SHA256SUMS consistent')
d = kopie(); { const p = path.join(d, origineel[2].f); const v = JSON.parse(fs.readFileSync(p, 'utf8')); v.expected.ok = true; fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); sums(d) } r = draai(d)
t('expected result edited and the hash list rebuilt: the verifier no longer agrees', r.code === 1 && r.uit.includes('FAIL  ' + origineel[2].v.id))
d = kopie(); fs.rmSync(path.join(d, eerste.f)); sums(d)
r = draai(d)
t('a vector removed together with its SHA256SUMS line passes without --expect (the documented limit)', r.code === 0 && /20 vectors, 20 pass/.test(r.uit))
r = draai(d, stub, ['--expect=21'])
t('... and --expect=21 catches it', r.code === 1 && /expected 21 vectors, found 20/.test(r.uit))
d = kopie(); { const p = path.join(d, eerste.f); const v = JSON.parse(fs.readFileSync(p, 'utf8')); v.id = 'renamed'; fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); sums(d) } r = draai(d)
t('an id that does not match the file name', r.code === 1 && /filename does not match id/.test(r.uit))
d = kopie(); { fs.renameSync(path.join(d, eerste.f), path.join(d, eerste.v.id + '.json')); sums(d) } r = draai(d)
t('a file name without the two-digit number', r.code === 1 && /filename does not match id/.test(r.uit))
d = kopie(); { const p = path.join(d, eerste.f); const v = JSON.parse(fs.readFileSync(p, 'utf8')); delete v.document; fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); sums(d) } r = draai(d)
t('a vector without a document', r.code === 1 && /bad or missing document/.test(r.uit))
d = kopie(); { const p = path.join(d, eerste.f); const v = JSON.parse(fs.readFileSync(p, 'utf8')); v.expected = {}; fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); sums(d) } r = draai(d)
t('a vector with an empty expected', r.code === 1 && /bad or missing expected/.test(r.uit))
d = kopie(); { const p = path.join(d, eerste.f); const v = JSON.parse(fs.readFileSync(p, 'utf8')); v.kind = 'maybe'; fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); sums(d) } r = draai(d)
t('an unknown kind', r.code === 1 && /bad or missing kind/.test(r.uit))

d = kopie(); { const naam = '98-' + eerste.v.id + '.json'; fs.writeFileSync(path.join(d, naam), fs.readFileSync(path.join(d, eerste.f))); sums(d) } r = draai(d)
t('the same vector id twice under two file numbers', r.code === 1 && /duplicate vector id/.test(r.uit))

console.log('a Windows checkout')
d = kopie()
for (const f of fs.readdirSync(d)) if (f.endsWith('.json') || f === 'SHA256SUMS') fs.writeFileSync(path.join(d, f), fs.readFileSync(path.join(d, f), 'utf8').replace(/\n/g, '\r\n'))
r = draai(d, stub, ['--expect=21'])
t('every vector and SHA256SUMS with CRLF line endings still verifies', r.code === 0 && /21 vectors, 21 pass/.test(r.uit), r.uit.slice(-200))

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${goed} passed, ${fout} failed`)
process.exit(fout ? 1 : 0)
