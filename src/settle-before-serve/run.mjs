#!/usr/bin/env node
// Runs the reference and every wrong twin over vectors/settle-before-serve/vectors.json, then drops each vector in turn to see which ones carry weight.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.
import { readFileSync } from 'node:fs'
import { decide } from './decide.mjs'
import { TWINS } from './twins.mjs'

const set = JSON.parse(readFileSync(new URL('../../vectors/settle-before-serve/vectors.json', import.meta.url), 'utf8'))
const same = (a, b) => ['status', 'delivers', 'callsFacilitator', 'builtBeforeSettle'].every((k) => a[k] === b[k])
const short = (id) => id.replace('x402-settle-before-serve-', '')
const asserted = set.vectors.filter((v) => v.asserted !== false)

let bad = 0
for (const v of set.vectors) {
  const got = decide(v.input)
  if (v.asserted !== false && !same(got, v.expected)) {
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
  try { return !same(fn(v.input), v.expected) } catch { return true }
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
