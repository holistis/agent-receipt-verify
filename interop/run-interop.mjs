#!/usr/bin/env node
// Interop harness for the section 5.5 known-answer vectors (vectors/attempt-identity/known-answer-*.json).
//
// It runs two independent implementations over the same files and judges them with five rules:
//   our own Node implementation (src/canonical-request.mjs) and the Python checker in interop/python/ (standard library only,
//   written from the text of the section by ruiruii).
//
// Why rules beyond "every file behaves as expected": a wrong file passes the published verdict as soon as the computed value
// differs from the recorded one, for ANY reason, so a checker that returns the same constant for every field passes all eleven
// wrong files. The twin rule closes that: a wrong file must differ for the right reason, meaning the computed value equals what
// its right twin records.
//
//   R1 TWIN-DIFFERS  a wrong value really differs from the value its right twin records.
//   R2 AGREE         both implementations compute the same value for every field of every file.
//   R3 RIGHT         on a right file both implementations compute exactly the recorded value.
//   R4 TWIN          on a wrong file both implementations compute what the right twin records (and not the wrong value).
//   R5 COPIES        the copies in interop/python/vectors are byte for byte the files in vectors/attempt-identity
//                    (compared with CRLF turned into LF, so a Windows checkout gives the same result).
//   SET              the file set is complete: every right file has a wrong twin and the other way round; with --expect=N exactly N files.
//   ALIGN            both implementations returned the same fields, in the same order, for every file.
//
// Usage:  node interop/run-interop.mjs [--expect=22] [--json] [--vectors=<dir>] [--python=<script>] [--copies=<dir>]
// Exit 0: no violation. 1: at least one violation. 2: the harness itself could not run (no Python, unreadable output): never a pass.
//
// Cite as: github.com/holistis/agent-receipt-verify, interop, 2026-11-20.
// The Python checker is by Rachel (github.com/ruiruii), Apache-2.0, see interop/python/README.md.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { canonicalMembers } from '../src/canonical-request.mjs'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export const tweeling = (naam) => (naam.endsWith('-wrong.json') ? naam.replace(/-wrong\.json$/, '.json') : naam)

const crlfNaarLf = (buf) => {
  const uit = []
  for (let i = 0; i < buf.length; i++) if (!(buf[i] === 13 && buf[i + 1] === 10)) uit.push(buf[i])
  return Buffer.from(uit)
}
const sha = (buf) => crypto.createHash('sha256').update(crlfNaarLf(buf)).digest('hex')

/** Reads every known-answer-*.json in a directory: Map(name -> { vec, bytes }). */
export function leesVectoren(dir) {
  const uit = new Map()
  for (const naam of fs.readdirSync(dir).filter((f) => /^known-answer-.*\.json$/.test(f)).sort()) {
    const bytes = fs.readFileSync(path.join(dir, naam))
    uit.set(naam, { vec: JSON.parse(bytes.toString('utf8')), bytes })
  }
  return uit
}

/** The fields a vector asks us to check, in order: one entry per (known_answer, observed field). */
export function velden(vec) {
  const lijst = []
  ;(vec.input?.known_answers ?? []).forEach((ka, i) => {
    for (const veld of Object.keys(ka.observed ?? {})) lijst.push({ i, veld, recorded: ka.observed[veld] })
  })
  return lijst
}

/** Our own Node implementation: what do we compute for each field of a vector? */
export function nodeBerekening(vec) {
  return velden(vec).map(({ i, veld }) => {
    const raw = vec.input.known_answers[i].raw ?? {}
    if (veld !== 'query' && veld !== 'body_sha256') return { field: veld, computed: null, skipped: true }
    try {
      const leden = canonicalMembers(raw)
      return { field: veld, computed: veld === 'query' ? (leden.query ?? '') : (leden.body ?? '') }
    } catch (e) {
      return { field: veld, computed: `error: ${String(e.message).slice(0, 80)}` }
    }
  })
}

/**
 * The judge. Pure function: it only looks at what it is given, so a test can feed it a wrong implementation.
 *   vectoren      Map(name -> { vec, bytes })
 *   berekeningen  { node: Map(name -> [{field, computed, reading?, skipped?}]), python: Map(...) }
 *   kopieen       Map(name -> { bytes }) or null to skip R5
 *   verwacht      number of files that must exist, or null
 */
export function beoordeel({ vectoren, berekeningen, kopieen = null, verwacht = null }) {
  const fouten = []
  const bij = (regel, file, rest = {}) => fouten.push({ rule: regel, file, ...rest })
  let controles = 0

  if (verwacht !== null && vectoren.size !== verwacht) bij('SET', '(set)', { detail: `expected ${verwacht} files, found ${vectoren.size}` })

  for (const [naam, { vec }] of vectoren) {
    const uitkomst = vec.expected?.outcome
    if (uitkomst !== 'PASS' && uitkomst !== 'FAIL') { bij('SET', naam, { detail: `expected.outcome is ${JSON.stringify(uitkomst)}, not PASS or FAIL` }); continue }
    const tw = vectoren.get(tweeling(naam))
    if (uitkomst === 'FAIL' && !tw) { bij('SET', naam, { detail: 'a wrong file without its right twin' }); continue }
    if (uitkomst === 'FAIL' && tw.vec.expected?.outcome !== 'PASS') { bij('SET', naam, { detail: 'the twin of a wrong file is not a PASS file' }); continue }
    if (uitkomst === 'PASS' && !vectoren.has(naam.replace(/\.json$/, '-wrong.json'))) bij('SET', naam, { detail: 'a right file without its wrong twin' })

    const mijn = velden(vec)
    const twVelden = tw ? velden(tw.vec) : []
    const n = berekeningen.node.get(naam)
    const p = berekeningen.python.get(naam)
    if (!n || !p || n.length !== mijn.length || p.length !== mijn.length) {
      bij('ALIGN', naam, { detail: `file has ${mijn.length} field(s); node returned ${n ? n.length : 'nothing'}, python returned ${p ? p.length : 'nothing'}` })
      continue
    }
    mijn.forEach((v, k) => {
      if (n[k].field !== v.veld || p[k].field !== v.veld) { bij('ALIGN', naam, { field: v.veld, detail: `field order differs: node ${n[k].field}, python ${p[k].field}` }); return }
      if (n[k].skipped || p[k].skipped) return
      controles++
      const ctx = { field: v.veld, recorded: v.recorded, node: n[k].computed, python: p[k].computed, reading: p[k].reading }
      if (n[k].computed !== p[k].computed) bij('R2', naam, { ...ctx, detail: 'the two implementations disagree' })
      if (uitkomst === 'PASS') {
        if (n[k].computed !== v.recorded || p[k].computed !== v.recorded) bij('R3', naam, { ...ctx, detail: 'an implementation does not compute the recorded value on a right file' })
      } else {
        const recht = twVelden[k]?.recorded
        if (recht === v.recorded) bij('R1', naam, { ...ctx, twin: recht, detail: 'the wrong value equals the value its right twin records' })
        if (n[k].computed !== recht || p[k].computed !== recht) bij('R4', naam, { ...ctx, twin: recht, detail: 'an implementation does not compute what the right twin records' })
      }
    })
  }

  if (kopieen) {
    for (const [naam, { bytes }] of vectoren) {
      const k = kopieen.get(naam)
      if (!k) bij('R5', naam, { detail: 'missing in the copies' })
      else if (sha(k.bytes) !== sha(bytes)) bij('R5', naam, { detail: 'the copy differs from the original' })
    }
    for (const naam of kopieen.keys()) if (!vectoren.has(naam)) bij('R5', naam, { detail: 'a copy without an original' })
  }

  const goed = [...vectoren.values()].filter((x) => x.vec.expected?.outcome === 'PASS').length
  return { fouten, bestanden: vectoren.size, rechts: goed, fout: vectoren.size - goed, controles }
}

function pythonVinden() {
  for (const naam of ['python3', 'python']) {
    const r = spawnSync(naam, ['--version'], { encoding: 'utf8' })
    if (!r.error && r.status === 0) return naam
  }
  return null
}

export function pythonBerekening(script, dir, vectoren) {
  const py = pythonVinden()
  if (!py) throw new Error('no Python found (tried python3 and python); the harness cannot run without it, which is never a pass')
  const r = spawnSync(py, ['-I', script, dir, '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  let records
  try { records = JSON.parse(r.stdout) } catch { throw new Error(`the Python checker did not return JSON (exit ${r.status}): ${String(r.stderr || r.stdout).slice(0, 200)}`) }
  const perId = new Map(records.map((x) => [x.id, x]))
  const uit = new Map()
  for (const [naam, { vec }] of vectoren) {
    const rec = perId.get(vec.id)
    if (rec) uit.set(naam, rec.fields.map((f) => ({ field: f.field, computed: f.computed, reading: f.reading, skipped: f.skipped === true })))
  }
  return uit
}

const REGELTEKST = {
  SET: 'the file set is complete (pairs, count)',
  ALIGN: 'both implementations returned the same fields for every file',
  R1: 'a wrong value really differs from its right twin',
  R2: 'the two implementations agree on every field',
  R3: 'on a right file both compute the recorded value',
  R4: 'on a wrong file both compute what the right twin records',
  R5: 'the copies are byte for byte the originals',
}

function main() {
  const arg = (naam) => { const a = process.argv.find((x) => x.startsWith(`--${naam}=`)); return a ? a.slice(naam.length + 3) : undefined }
  const vectorDir = path.resolve(arg('vectors') ?? path.join(wortel, 'vectors', 'attempt-identity'))
  const pyScript = path.resolve(arg('python') ?? path.join(wortel, 'interop', 'python', 'verify_known_answers.py'))
  const kopieDir = path.resolve(arg('copies') ?? path.join(wortel, 'interop', 'python', 'vectors'))
  const verwacht = arg('expect') === undefined ? null : Number(arg('expect'))
  const alsJson = process.argv.includes('--json')
  if (verwacht !== null && !Number.isInteger(verwacht)) { console.error('--expect must be a whole number'); process.exit(2) }

  let uitslag
  try {
    const vectoren = leesVectoren(vectorDir)
    if (vectoren.size === 0) throw new Error(`no known-answer files in ${vectorDir}`)
    const kopieen = fs.existsSync(kopieDir) ? leesVectoren(kopieDir) : null
    const node = new Map([...vectoren].map(([naam, { vec }]) => [naam, nodeBerekening(vec)]))
    const python = pythonBerekening(pyScript, vectorDir, vectoren)
    uitslag = beoordeel({ vectoren, berekeningen: { node, python }, kopieen, verwacht })
  } catch (e) {
    console.error('harness error: ' + e.message)
    process.exit(2)
  }

  if (alsJson) console.log(JSON.stringify(uitslag, null, 2))
  else {
    console.log(`interop: ${uitslag.bestanden} files (${uitslag.rechts} right, ${uitslag.fout} wrong), ${uitslag.controles} field checks, two implementations`)
    for (const regel of Object.keys(REGELTEKST)) {
      const aantal = uitslag.fouten.filter((f) => f.rule === regel).length
      console.log(`  ${regel.padEnd(5)} ${aantal === 0 ? 'ok  ' : 'FAIL'}  ${REGELTEKST[regel]}${aantal ? `  (${aantal})` : ''}`)
    }
    for (const f of uitslag.fouten) {
      console.log(`\n  ${f.rule}  ${f.file}${f.field ? '  field: ' + f.field : ''}\n     ${f.detail}`)
      if (f.recorded !== undefined) console.log(`     recorded : ${f.recorded}`)
      if (f.node !== undefined) console.log(`     node     : ${f.node}`)
      if (f.python !== undefined) console.log(`     python   : ${f.python}`)
      if (f.twin !== undefined) console.log(`     twin     : ${f.twin}`)
      if (f.reading) console.log(`     reading  : ${f.reading}`)
    }
    console.log(uitslag.fouten.length ? '\nFAIL' : '\nOK')
  }
  process.exit(uitslag.fouten.length ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
