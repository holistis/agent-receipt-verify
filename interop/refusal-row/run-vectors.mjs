// Runs the frozen refusal-row implementation over the 76 vector files of github.com/ruiruii/sycee at d9552b8 (data only, nothing of hers is executed).
// Reports every divergence with both values, ours included. Written to be run once, after the registration message was posted.
// Cite as: github.com/holistis/agent-receipt-verify, interop/refusal-row, 2026-11-23.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [implPath, vecDir, outPath] = process.argv.slice(2)
const LEGS_AS_STATUS = process.argv.includes('--legs-as-status')
// Exploratory only, decided after the vectors were seen: her files write a leg as a plain string, the implementation reads it as an object with a status (ambiguity A18).
const shape = (inp) => { if (!LEGS_AS_STATUS || !inp || !inp.legs || typeof inp.legs !== 'object') return inp; const l = {}; for (const [k, v] of Object.entries(inp.legs)) l[k] = typeof v === 'string' ? { status: v } : v; return { ...inp, legs: l } }
if (!implPath || !vecDir || !outPath) { console.error('usage: node run-refusal-vectors.mjs <refusal-row.mjs> <vectors dir> <result.json>'); process.exit(2) }
const REGISTERED = 'def9ffa708a9d542d5047efdc2aa1a8385898156d995611bc1b8c89088eff912'
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const implSha = sha(fs.readFileSync(implPath))
if (implSha !== REGISTERED) { console.error('the implementation is not the registered one: ' + implSha); process.exit(2) }
const { evaluate } = await import(pathToFileURL(path.resolve(implPath)).href)

const files = fs.readdirSync(vecDir).filter((f) => f.endsWith('.json')).sort()
const manifest = sha(files.map((f) => sha(fs.readFileSync(path.join(vecDir, f))) + '  ' + f).join('\n') + '\n')
const J = new Map(files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(vecDir, f), 'utf8'))]))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const rows = []
for (const f of files) {
  const j = J.get(f)
  let out
  try { out = evaluate(shape(j.input)) } catch (e) { out = { outcome: 'THROWS', error: String(e.message) } }
  const wrong = f.endsWith('-wrong.json')
  rows.push({ file: f, wrong, expected: j.expected, observed: j.observed, ours: out })
}

const divergences = []
let outcomeSame = 0, codeSame = 0, codeNames = [], fieldsChecked = 0, fieldsSame = 0
for (const r of rows) {
  const exp = r.expected || {}
  const o = r.ours
  if (o.outcome === exp.outcome) outcomeSame++
  else divergences.push({ file: r.file, kind: 'outcome', recorded: exp.outcome + (exp.code ? ' ' + exp.code : ''), ours: o.outcome + (o.code ? ' ' + o.code : '') + (o.error ? ' ' + o.error : '') })
  if (exp.outcome === 'REJECT' && o.outcome === 'REJECT') {
    if (o.code === exp.code) codeSame++
    else { codeNames.push({ file: r.file, recorded: exp.code, ours: o.code }); divergences.push({ file: r.file, kind: 'code', recorded: exp.code, ours: o.code }) }
  }
  if (exp.outcome === 'ACCEPT' && o.outcome === 'ACCEPT' && !r.wrong && r.observed) {
    for (const k of Object.keys(r.observed)) {
      fieldsChecked++
      const ours = o.fields ? o.fields[k] : undefined
      if (same(ours, r.observed[k])) fieldsSame++
      else divergences.push({ file: r.file, kind: 'field ' + k, recorded: r.observed[k], ours })
    }
  }
}
// twin rule: on a wrong file our computed field must equal the value its right twin records, and must differ from the wrong value on a field where the two twins differ
const twins = []
for (const r of rows.filter((x) => x.wrong)) {
  const rightName = r.file.replace(/-wrong\.json$/, '.json')
  const right = rows.find((x) => x.file === rightName)
  if (!right || !right.observed || !r.observed) continue
  const o = r.ours
  for (const k of Object.keys(right.observed)) {
    const ours = o.fields ? o.fields[k] : undefined
    twins.push({ file: r.file, field: k, ours, rightRecords: right.observed[k], wrongRecords: r.observed[k], ok: same(ours, right.observed[k]) && (same(right.observed[k], r.observed[k]) || !same(ours, r.observed[k])) })
  }
}
const result = {
  mode: LEGS_AS_STATUS ? 'exploratory, legs written as {status}, decided after seeing the vectors' : 'primary, registered implementation, vectors as they are',
  registered_implementation_sha256: REGISTERED,
  implementation_sha256: implSha,
  vector_files: files.length,
  vector_manifest_sha256: manifest,
  accept: rows.filter((r) => r.expected && r.expected.outcome === 'ACCEPT').length,
  reject: rows.filter((r) => r.expected && r.expected.outcome === 'REJECT').length,
  outcome_same: outcomeSame,
  reject_code_same: codeSame,
  reject_code_different: codeNames.length,
  accepted_fields_checked: fieldsChecked,
  accepted_fields_same: fieldsSame,
  twin_checks: twins.length,
  twin_checks_ok: twins.filter((t) => t.ok).length,
  divergences,
  twin_failures: twins.filter((t) => !t.ok),
}
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ ...result, divergences: result.divergences.length, twin_failures: result.twin_failures.length }, null, 2))
