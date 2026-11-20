#!/usr/bin/env node
// vector-coverage: which rules of a known-answer vector set have NO file that exercises them?
//
// A test set that every correct implementation passes tells you little unless a wrong one fails. Before you can ask that, there is a cheaper
// question that needs no implementation at all: of the values your specification says a field may take, which ones appear in no vector?
// A rule without a vector is a rule nobody can notice being broken. This tool counts, from the files alone, and reports what it cannot see.
//
// What it does NOT do: it does not run an implementation and does not plant mistakes. A value that appears in a vector is not thereby tested
// against every wrong reading of it; this is a floor, not a score.
//
// Usage:  node tools/vector-coverage.mjs <vectors-dir> --profile=<profile.json> [--json] [--strict]
//   --strict  exit 1 when anything is reported (the default is exit 0 with the report; an unreadable set is always exit 2)
// Exit: 0 report printed (no findings, or findings without --strict), 1 findings with --strict, 2 the tool could not measure (never a pass).
//
// The profile (JSON) says what to count:
//   name         free text
//   pattern      regular expression for the file names of the set
//   wrongSuffix  right file X.json and its wrong twin X<suffix>.json (default "-wrong")
//   rejectPrefix files whose name starts with this are rejection files: no wrong twin expected (optional)
//   dimensions   [{ path: "input.reason", closedSet: [...], label, in }]  dotted path into the file; the declared values you want covered.
//                in: "right" (default, the right files count; a value only in rejection files is reported apart), "reject" or "any"
//   context      [{ when: "input.settlement", is: "pending", vary: "input.reason" }]  the files with when==is, and how many distinct `vary` values they have
//
// Cite as: github.com/holistis/agent-receipt-verify, tools/vector-coverage.mjs, 2026-11-20.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pak = (obj, dotted) => dotted.split('.').reduce((o, k) => (o !== null && typeof o === 'object' && k in o ? o[k] : undefined), obj)
const sleutelVan = (v) => JSON.stringify(v)

/** Pure: files is a Map name -> parsed JSON. Returns the findings and the tables. */
export function meet(files, profiel) {
  const suffix = profiel.wrongSuffix ?? '-wrong'
  const wrongNaam = (n) => n.replace(/\.json$/, suffix + '.json')
  const isWrong = (n) => n.endsWith(suffix + '.json')
  const isReject = (n) => (profiel.rejectPrefix ? n.startsWith(profiel.rejectPrefix) : false)
  const namen = [...files.keys()].sort()
  const wrongs = namen.filter(isWrong)
  const rechts = namen.filter((n) => !isWrong(n) && !isReject(n))
  const rejects = namen.filter((n) => !isWrong(n) && isReject(n))
  const bevindingen = []

  // 1. the twin rule's shape: every right file has a wrong twin and the other way round; the twin has the same input and a different answer
  for (const n of rechts) if (!files.has(wrongNaam(n))) bevindingen.push({ soort: 'twin-ontbreekt', bestand: n, uitleg: 'right file without a wrong twin ' + wrongNaam(n) })
  for (const w of wrongs) {
    const r = w.replace(suffix + '.json', '.json')
    if (!files.has(r)) { bevindingen.push({ soort: 'twin-wees', bestand: w, uitleg: 'wrong file without its right twin ' + r }); continue }
    const a = files.get(r), b = files.get(w)
    if (sleutelVan(a.input) !== sleutelVan(b.input)) bevindingen.push({ soort: 'twin-andere-invoer', bestand: w, uitleg: 'the wrong twin does not have the same input as ' + r })
    if (sleutelVan(a.observed) === sleutelVan(b.observed)) bevindingen.push({ soort: 'twin-gelijk', bestand: w, uitleg: 'the wrong twin records the same answer as ' + r + ': it is not wrong' })
  }

  // 2. declared values: which appear in no file at all, which appear but are not declared
  const tabellen = []
  for (const d of profiel.dimensions ?? []) {
    const waar = d.in ?? 'right' // which files count as coverage: the right files, the rejection files, or both
    const bereik = waar === 'reject' ? rejects : waar === 'any' ? [...rechts, ...rejects] : rechts
    const waarde = (n) => { const v = pak(files.get(n), d.path); return v === undefined ? undefined : typeof v === 'string' ? v : sleutelVan(v) }
    const gezien = new Map()
    for (const n of bereik) { const k = waarde(n); if (k !== undefined) gezien.set(k, (gezien.get(k) ?? 0) + 1) }
    const alleenAfwijzing = new Set()
    if (waar === 'right') for (const n of rejects) { const k = waarde(n); if (k !== undefined && !gezien.has(k)) alleenAfwijzing.add(k) }
    const gesloten = d.closedSet ?? null
    const nooit = gesloten ? gesloten.filter((v) => !gezien.has(v) && !alleenAfwijzing.has(v)) : []
    const alleenRej = gesloten ? gesloten.filter((v) => alleenAfwijzing.has(v)) : []
    const onbekend = gesloten ? [...gezien.keys()].filter((v) => !gesloten.includes(v)) : []
    tabellen.push({ pad: d.path, label: d.label ?? d.path, in: waar, gezien: Object.fromEntries(gezien), nooitGezien: nooit, alleenInAfwijzing: alleenRej, onbekend, gedeclareerd: gesloten ? gesloten.length : null })
    for (const v of nooit) bevindingen.push({ soort: 'waarde-zonder-vector', pad: d.path, waarde: v, uitleg: d.path + ' = ' + v + ' appears in no file' })
    for (const v of alleenRej) bevindingen.push({ soort: 'waarde-alleen-in-afwijzing', pad: d.path, waarde: v, uitleg: d.path + ' = ' + v + ' appears only in rejection files, in no right file' })
    for (const v of onbekend) bevindingen.push({ soort: 'waarde-buiten-lijst', pad: d.path, waarde: v, uitleg: d.path + ' = ' + v + ' is used by a ' + (waar === 'reject' ? 'rejection' : 'right') + ' file but is not in the declared set' })
  }

  // 3. context: the files for one value, and how many different contexts they come from
  const contexten = []
  for (const c of profiel.context ?? []) {
    const vallen = [...rechts, ...rejects].filter((n) => pak(files.get(n), c.when) === c.is)
    const verschillend = new Set(vallen.map((n) => String(pak(files.get(n), c.vary))))
    contexten.push({ wanneer: c.when + ' = ' + c.is, variatie: c.vary, bestanden: vallen.length, verschillendeWaarden: [...verschillend] })
    if (vallen.length > 0 && verschillend.size === 1) bevindingen.push({ soort: 'een-context', pad: c.when, waarde: c.is, uitleg: 'every file with ' + c.when + ' = ' + c.is + ' (' + vallen.length + ') has the same ' + c.vary + ' (' + [...verschillend][0] + '): a rule that holds only for that one is not told apart' })
  }
  return { bestanden: namen.length, rechts: rechts.length, wrongTwins: wrongs.length, afwijzingen: rejects.length, bevindingen, tabellen, contexten }
}

export function leesMap(dir, patroon) {
  const re = new RegExp(patroon ?? '\\.json$')
  const namen = fs.readdirSync(dir).filter((n) => re.test(n)).sort()
  const files = new Map()
  for (const n of namen) files.set(n, JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')))
  return files
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--'))
  const profielPad = (process.argv.find((a) => a.startsWith('--profile=')) ?? '').slice(10)
  try {
    if (!dir || !profielPad) { console.log('usage: node tools/vector-coverage.mjs <vectors-dir> --profile=<profile.json> [--json] [--strict]'); process.exit(2) }
    const profiel = JSON.parse(fs.readFileSync(profielPad, 'utf8'))
    const files = leesMap(dir, profiel.pattern)
    if (files.size === 0) { console.log('NOT MEASURED: no file in ' + dir + ' matches ' + (profiel.pattern ?? '\\.json$') + '. An empty set is never a pass.'); process.exit(2) }
    const r = meet(files, profiel)
    if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1))
    else {
      console.log((profiel.name ?? 'vector set') + ': ' + r.bestanden + ' files = ' + r.rechts + ' right + ' + r.wrongTwins + ' wrong twins + ' + r.afwijzingen + ' rejections')
      for (const t of r.tabellen) console.log('  ' + t.label.padEnd(14) + (t.gedeclareerd != null ? (t.gedeclareerd - t.nooitGezien.length) + ' of ' + t.gedeclareerd + ' declared values appear' : Object.keys(t.gezien).length + ' distinct values') + (t.nooitGezien.length ? '; in no file: ' + t.nooitGezien.join(', ') : '') + (t.alleenInAfwijzing.length ? '; only in rejection files: ' + t.alleenInAfwijzing.join(', ') : ''))
      for (const c of r.contexten) console.log('  ' + c.wanneer + ': ' + c.bestanden + ' files, ' + c.variatie + ' takes ' + c.verschillendeWaarden.length + ' value(s): ' + c.verschillendeWaarden.join(', '))
      console.log(r.bevindingen.length ? r.bevindingen.length + ' finding(s):' : 'no findings')
      for (const b of r.bevindingen) console.log('  - ' + b.soort + ': ' + b.uitleg)
      console.log('This counts values in files. It does not run an implementation and is not a score.')
    }
    process.exit(process.argv.includes('--strict') && r.bevindingen.length ? 1 : 0)
  } catch (e) { console.log('NOT MEASURED: ' + e.message); process.exit(2) }
}
