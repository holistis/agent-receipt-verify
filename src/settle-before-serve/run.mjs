#!/usr/bin/env node
// Runs the reference and every wrong twin over vectors/settle-before-serve/vectors.json, then drops each vector in turn to see which ones carry weight.
//
//   node run.mjs                         the reference and every wrong twin
//   node run.mjs --impl path/to/module   your own implementation: a module that exports decide(observation); exit 1 if an asserted vector fails
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decide, matches } from './decide.mjs'
import { TWINS } from './twins.mjs'

const set = JSON.parse(readFileSync(new URL('../../vectors/settle-before-serve/vectors.json', import.meta.url), 'utf8'))
const short = (id) => id.replace('x402-settle-before-serve-', '')
const asserted = set.vectors.filter((v) => v.asserted !== false)

const implAt = process.argv.indexOf('--impl')
if (implAt !== -1) {
  const file = process.argv[implAt + 1]
  if (!file) { console.error('usage: node run.mjs --impl <path to a module that exports decide(observation)>'); process.exit(2) }
  let mod
  try { mod = await import(pathToFileURL(resolve(file)).href) } catch (e) { console.error('cannot load ' + file + ': ' + String(e.message).split('\n')[0]); process.exit(2) }
  if (typeof mod.decide !== 'function') { console.error(file + ' does not export a function decide(observation)'); process.exit(2) }
  let failed = 0
  for (const v of set.vectors) {
    let got, err
    try { got = await mod.decide(structuredClone(v.input)) } catch (e) { err = String(e.message).split('\n')[0] }
    const answer = got && typeof got === 'object' ? got : undefined
    if (v.asserted === false) {
      console.log(`open  ${short(v.id)}: ${err ? 'threw ' + err : answer ? answer.status : 'no answer'} (nothing is asserted)`)
      continue
    }
    const ok = !err && !!answer && matches(answer, v.expected)
    if (!ok) failed++
    console.log(`${ok ? 'pass' : 'FAIL'}  ${short(v.id)}${ok ? '' : err ? '  threw: ' + err : '  gave ' + JSON.stringify(answer || null) + ', expected ' + JSON.stringify(v.expected)}`)
  }
  console.log(`your implementation: ${asserted.length - failed} of ${asserted.length} asserted vectors pass, ${set.vectors.length - asserted.length} open vectors shown for information`)
  process.exit(failed ? 1 : 0)
}

let bad = 0
for (const v of set.vectors) {
  let got
  try { got = decide(v.input) } catch (e) { bad++; console.log('REFERENCE THROWS', v.id, String(e.message).split('\n')[0]); continue }
  if (v.asserted !== false && !matches(got, v.expected)) {
    bad++
    console.log('REFERENCE FAILS', v.id, JSON.stringify(got))
  }
  if (v.asserted === false && got.status !== v.expected.status) {
    bad++
    console.log('OPEN VECTOR NO LONGER OPEN', v.id, JSON.stringify(got))
  }
}
console.log(`reference: ${set.vectors.length - bad} of ${set.vectors.length} vectors, ${set.vectors.length - asserted.length} recorded as open`)

const caught = (fn, list) => list.filter((v) => {
  try { return !matches(fn(v.input), v.expected) } catch { return true }
})

let survivors = 0
for (const [name, fn] of Object.entries(TWINS)) {
  const k = caught(fn, asserted).map((v) => short(v.id))
  if (k.length === 0) survivors++
  const tag = k.length === 0 ? 'SURVIVES' : k.length === 1 ? 'caught by 1 (fragile)' : `caught by ${k.length}`
  console.log(`${tag}  ${name}${k.length ? '  <- ' + k.join(', ') : ''}`)
}
console.log(`wrong twins caught: ${Object.keys(TWINS).length - survivors} of ${Object.keys(TWINS).length}`)

let loadBearing = 0
for (const v of asserted) {
  const rest = asserted.filter((x) => x !== v)
  const lost = Object.entries(TWINS).filter(([, fn]) => caught(fn, rest).length === 0).map(([n]) => n)
  if (lost.length) {
    loadBearing++
    console.log(`only catcher: ${short(v.id)} -> ${lost.join('; ')}`)
  }
}
console.log(`vectors that are the only catcher of some twin: ${loadBearing} of ${asserted.length}`)
process.exit(bad || survivors || set.vectors.length === 0 ? 1 : 0)
