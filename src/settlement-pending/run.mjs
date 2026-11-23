#!/usr/bin/env node
// Runs the reference and every wrong twin over vectors.json, then drops each vector in turn to see which ones carry weight.
// A vector may carry expected.acceptable: the answers a seller may give besides the one the reference gives. The reference
// must give expected.outcome exactly, acceptable must contain it, and acceptable may never allow a delivery that the
// reference does not make. A twin is caught when its answer is outside what the vector allows.
import { readFileSync } from 'node:fs'
import { decide, matches } from './decide.mjs'
import { TWINS } from './twins.mjs'

const set = JSON.parse(readFileSync(new URL('../../vectors/settlement-pending/vectors.json', import.meta.url), 'utf8'))
const short = (id) => id.replace('x402-settlement-pending-', '')
const asserted = set.vectors.filter((v) => v.asserted !== false)

let bad = 0
for (const v of set.vectors) {
  const got = decide(v.input)
  if (got.outcome !== v.expected.outcome || got.secondSettle !== v.expected.secondSettle) {
    bad++
    console.log('REFERENCE FAILS', v.id, JSON.stringify(got))
  }
  const a = v.expected.acceptable
  if (a && !a.includes(v.expected.outcome)) { bad++; console.log('ACCEPTABLE LACKS THE EXPECTED ANSWER', v.id) }
  if (a && a.includes('DELIVER') && v.expected.outcome !== 'DELIVER') { bad++; console.log('ACCEPTABLE ALLOWS A DELIVERY THE REFERENCE DOES NOT MAKE', v.id) }
}
const wide = set.vectors.filter((v) => v.expected.acceptable).length
console.log(`reference: ${set.vectors.length - bad} of ${set.vectors.length} vectors, ${set.vectors.length - asserted.length} recorded as open, ${wide} allow more than one answer`)

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
process.exit(bad || survivors ? 1 : 0)
