#!/usr/bin/env node
// Properties over random situations. Seeded, so every run is the same run.
// Each property is a statement about the observation and the answer, not a copy of decide(). The class of every header (absent,
// empty, unparseable, well-formed) comes from the generator's own list, not from decide()'s parser, so a wrong parser can break a property.
// Runs the reference (must violate nothing), then every wrong twin (each should violate at least one property, or be caught by the
// vectors; one that escapes both is reported).
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.
import { readFileSync } from 'node:fs'
import { decide } from './decide.mjs'
import { TWINS } from './twins.mjs'

const N = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) || 20000)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const rnd = mulberry32(20261123)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o), 'utf8').toString('base64')

const HEADERS = [
  [null, 'absent'], [undefined, 'absent'], ['', 'empty'],
  ['this-is-not-a-payment', 'unparseable'], ['0x12', 'unparseable'], ['0x' + 'zz'.repeat(32), 'unparseable'], ['   ', 'unparseable'],
  [b64('not json'), 'unparseable'], [b64({ x402Version: 2 }), 'unparseable'], [b64({ payload: {} }), 'unparseable'], [b64([1, 2]), 'unparseable'],
  ['0x' + 'ab'.repeat(32), 'wellformed'], ['0x' + 'AB'.repeat(32), 'wellformed'],
  [b64({ x402Version: 2, payload: { signature: '0x' + '11'.repeat(65) } }), 'wellformed'],
  [b64({ x402Version: 1, payload: { authorization: {} } }), 'wellformed'],
]
const CAT = new Map()
function gen() {
  const [paymentSignature, cat] = pick(HEADERS)
  const obs = {
    paymentSignature,
    facilitator: { result: pick(['success', 'failed', 'error']), latencyMs: pick([0, 10, 900, 1001, 1500, 30000]) },
    fallback: pick(['confirmed', 'failed', 'not_tried']),
  }
  CAT.set(obs, cat)
  return obs
}
const clone = (o, f) => { const c = f(structuredClone(o)); CAT.set(c, CAT.get(o)); return c }

const confirmed = (o) => o.facilitator.result === 'success' || o.fallback === 'confirmed'
const PROPS = {
  P1: ['paid data is never delivered without a well-formed header and a confirmed settlement (facilitator success or fallback confirmed)', (o, d) => !d.delivers || (CAT.get(o) === 'wellformed' && confirmed(o))],
  P2: ['an unparseable header gets 400, delivers nothing and does not call the facilitator', (o, d) => CAT.get(o) !== 'unparseable' || (d.status === 400 && !d.delivers && !d.callsFacilitator)],
  P3: ['no header gets 402, delivers nothing and does not call the facilitator', (o, d) => CAT.get(o) !== 'absent' || (d.status === 402 && !d.delivers && !d.callsFacilitator)],
  P4: ['the data is never built before the settle result is in', (o, d) => d.builtBeforeSettle === false],
  P5: ['the speed of the facilitator never changes the status or the delivery', (o, d, fn) => {
    const o2 = clone(o, (c) => { c.facilitator.latencyMs = o.facilitator.latencyMs > 1000 ? 0 : 30000; return c })
    const e = fn(o2)
    return e.status === d.status && e.delivers === d.delivers
  }],
  P6: ['a well-formed header with a confirmed settlement is delivered with 200', (o, d) => CAT.get(o) !== 'wellformed' || !confirmed(o) || (d.status === 200 && d.delivers)],
  P7: ['a well-formed header with no confirmation gets 402 and delivers nothing', (o, d) => CAT.get(o) !== 'wellformed' || confirmed(o) || (d.status === 402 && !d.delivers)],
  P8: ['a facilitator error or timeout is treated like a failed settlement', (o, d, fn) => {
    if (o.facilitator.result === 'success') return true
    const o2 = clone(o, (c) => { c.facilitator.result = o.facilitator.result === 'error' ? 'failed' : 'error'; return c })
    const e = fn(o2)
    return e.status === d.status && e.delivers === d.delivers
  }],
  P9: ['the same observation gives the same answer twice', (o, d, fn) => JSON.stringify(fn(o)) === JSON.stringify(d)],
  P10: ['an empty header never delivers anything', (o, d) => CAT.get(o) !== 'empty' || !d.delivers],
}

const run = (fn) => {
  const hit = Object.fromEntries(Object.keys(PROPS).map((k) => [k, 0]))
  for (const o of OBS) {
    let d
    try { d = fn(o) } catch { for (const k of Object.keys(PROPS)) hit[k]++; continue }
    for (const [k, [, f]] of Object.entries(PROPS)) { let ok; try { ok = f(o, d, fn) } catch { ok = false } if (!ok) hit[k]++ }
  }
  return hit
}

const OBS = Array.from({ length: N }, gen)
console.log(`random situations: ${N}, seed 20261123`)
const ref = run(decide)
const refBad = Object.entries(ref).filter(([, n]) => n)
console.log('reference violations:', refBad.length ? refBad.map(([k, n]) => `${k}=${n}`).join(' ') : 'none')

const set = JSON.parse(readFileSync(new URL('../../vectors/settle-before-serve/vectors.json', import.meta.url), 'utf8'))
const asserted = set.vectors.filter((v) => v.asserted !== false)
const same = (a, b) => ['status', 'delivers', 'callsFacilitator', 'builtBeforeSettle'].every((k) => a[k] === b[k])
let both = 0, propsOnly = 0, vecOnly = 0, neither = 0
for (const [name, fn] of Object.entries(TWINS)) {
  const h = run(fn)
  const broken = Object.entries(h).filter(([, n]) => n).map(([k]) => k)
  const byVec = asserted.filter((v) => { try { return !same(fn(v.input), v.expected) } catch { return true } }).length
  const tag = broken.length && byVec ? 'both' : broken.length ? 'properties only' : byVec ? 'vectors only' : 'NEITHER'
  if (tag === 'both') both++; else if (tag === 'properties only') propsOnly++; else if (tag === 'vectors only') vecOnly++; else neither++
  console.log(`${tag.padEnd(16)} ${name}  props: ${broken.join(',') || '-'}  vectors: ${byVec}`)
}
console.log(`twins: ${Object.keys(TWINS).length}. caught by both ${both}, by properties only ${propsOnly}, by vectors only ${vecOnly}, by neither ${neither}`)
console.log('properties:'); for (const [k, [t]] of Object.entries(PROPS)) console.log(` ${k} ${t}`)
process.exit(refBad.length || neither || N < 1 ? 1 : 0)
