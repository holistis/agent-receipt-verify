// Plays the vectors in this folder against a verifier module.
//   node run.mjs <path to a module that exports verifyAuditDocument> [--export=verifyAuditDocument] [--expect=21]
// The module is imported and run, so only point it at code you trust.
// Before it plays anything it checks the suite against SHA256SUMS (a missing, extra, changed or duplicated vector is a PROBLEM)
// and each vector for the fields it needs. A verifier that throws counts as a FAIL for that vector, not as a crash.
// --expect=N also fails when the suite does not hold exactly N vectors, which is the only way to notice a vector that was
// removed together with its line in SHA256SUMS. Exit 0 only when there are no problems and every vector passes.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (naam) => { const a = args.find((x) => x.startsWith(`--${naam}=`)); return a ? a.slice(naam.length + 3) : undefined }
const modulePad = args.find((x) => !x.startsWith('--'))
const exportNaam = flag('export') ?? 'verifyAuditDocument'
const verwachtAantal = flag('expect') === undefined ? undefined : Number(flag('expect'))
const KINDS = new Set(['accept', 'reject', 'accept-by-design'])
const problemen = []

// bytes with CRLF turned into LF, so a Windows checkout with autocrlf gives the same hash as the blob in git
const crlfNaarLf = (buf) => {
  const uit = []
  for (let i = 0; i < buf.length; i++) if (!(buf[i] === 13 && buf[i + 1] === 10)) uit.push(buf[i])
  return Buffer.from(uit)
}
const hashVan = (buf) => crypto.createHash('sha256').update(crlfNaarLf(buf)).digest('hex')

if (!modulePad) { console.error('usage: node run.mjs <module> [--export=name] [--expect=N]'); process.exit(2) }
if (verwachtAantal !== undefined && !Number.isInteger(verwachtAantal)) { console.error('--expect must be a whole number'); process.exit(2) }

let bestanden = []
try { bestanden = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() } catch (e) { problemen.push('cannot read the suite folder: ' + e.message) }
if (bestanden.length === 0) problemen.push('no vectors found in the suite folder')

let lijst = null
try { lijst = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8') } catch { problemen.push('SHA256SUMS is missing or unreadable') }
if (lijst !== null) {
  const staat = new Map()
  for (const regel of (lijst.charCodeAt(0) === 0xfeff ? lijst.slice(1) : lijst).split(/\r?\n/)) {
    if (!regel.trim() || regel.startsWith('#')) continue
    const m = regel.match(/^([0-9a-fA-F]{64}) [ *](.+)$/)
    if (!m) { problemen.push('unreadable line in SHA256SUMS: ' + regel.slice(0, 60)); continue }
    if (staat.has(m[2])) problemen.push('duplicate line in SHA256SUMS: ' + m[2])
    staat.set(m[2], m[1].toLowerCase())
  }
  if (staat.size === 0) problemen.push('SHA256SUMS lists no vectors')
  for (const f of bestanden) {
    if (!staat.has(f)) problemen.push('vector not in SHA256SUMS: ' + f)
    else if (hashVan(fs.readFileSync(path.join(dir, f))) !== staat.get(f)) problemen.push('vector changed, hash differs: ' + f)
  }
  for (const f of staat.keys()) if (!bestanden.includes(f)) problemen.push('listed in SHA256SUMS but missing: ' + f)
}

const vectoren = []
const ids = new Set()
for (const f of bestanden) {
  let v
  try { v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { problemen.push('not valid JSON: ' + f); continue }
  const fout = []
  if (typeof v.id !== 'string' || !v.id) fout.push('id')
  else if (!/^\d\d-/.test(f) || f !== `${f.slice(0, 2)}-${v.id}.json`) fout.push('filename does not match id')
  if (!KINDS.has(v.kind)) fout.push('kind')
  if (!v.document || typeof v.document !== 'object') fout.push('document')
  if (!v.expected || typeof v.expected !== 'object' || Object.keys(v.expected).length === 0) fout.push('expected')
  if (fout.length) { problemen.push(`${f}: bad or missing ${fout.join(', ')}`); continue }
  if (ids.has(v.id)) { problemen.push('duplicate vector id: ' + v.id); continue }
  ids.add(v.id)
  vectoren.push({ ...v, bestand: f })
}
if (verwachtAantal !== undefined && vectoren.length !== verwachtAantal) problemen.push(`expected ${verwachtAantal} vectors, found ${vectoren.length}`)

let fn = null
try {
  const mod = await import(pathToFileURL(path.resolve(modulePad)).href)
  fn = mod[exportNaam]
  if (typeof fn !== 'function') problemen.push(`the module has no function export named ${exportNaam}`)
} catch (e) { problemen.push('cannot import the module: ' + String(e.message).split('\n')[0]) }

let goed = 0
let mis = 0
if (fn) {
  for (const v of vectoren) {
    let r
    try { r = await fn(structuredClone(v.document)) } catch (e) { r = { __threw: String(e && e.message).split('\n')[0] } }
    if (r && r.__threw !== undefined) { mis++; console.log(`  FAIL  ${v.id}  <- the verifier threw: ${r.__threw}`); continue }
    const afwijkend = Object.entries(v.expected).filter(([k, w]) => !r || r[k] !== w)
    if (afwijkend.length === 0) { goed++; console.log(`  pass  ${v.id}`) } else {
      mis++
      console.log(`  FAIL  ${v.id}  <- ${afwijkend.map(([k, w]) => `${k}: expected ${JSON.stringify(w)}, got ${JSON.stringify(r ? r[k] : undefined)}`).join('; ')}`)
    }
  }
}
for (const p of problemen) console.log('PROBLEM  ' + p)
console.log(`${vectoren.length} vectors, ${goed} pass, ${mis} fail, ${problemen.length} problem(s)`)
if (problemen.length || mis) { console.log('FAIL'); process.exit(1) }
console.log('OK')
