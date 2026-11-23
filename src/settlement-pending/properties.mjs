#!/usr/bin/env node
// Properties over random situations. Seeded, so every run is the same run.
// Each property is written as a statement about the observation, not as a copy of decide(), so a wrong twin can break it.
// Runs the reference (must violate nothing), then every wrong twin (each should violate at least one property,
// or be caught by the vectors; one that escapes both is reported).
import { readFileSync } from 'node:fs'
import { decide, PENDING } from './decide.mjs'
import { TWINS } from './twins.mjs'

const N = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) || 20000)
const low = (s) => String(s).toLowerCase()
const flip = (s) => String(s).replace(/[a-fA-F]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const rnd = mulberry32(20261122)
const pick = (a) => a[Math.floor(rnd() * a.length)]

const PAYTO = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'
const N1 = '0x' + 'a1'.repeat(32), N2 = '0x' + 'b2'.repeat(32)
const H = ['', '0x' + '1'.repeat(64), '0x' + '4'.repeat(64)]
const MSG = ['Receipt not found before timeout', 'settlement_pending: wait a moment', 'Transaction failed', '', 'authorization already used', 'pending']

function gen() {
  const price = BigInt(pick(['10000', '1', '9007199254740993', '1000000000000000000', '123456789012345678901']))
  const payTo = pick([PAYTO, PAYTO.toLowerCase(), flip(PAYTO)])
  const kind = pick(['success', 'pending', 'pending', 'pending', 'other'])
  const response = kind === 'success'
    ? { success: true, errorReason: null, errorMessage: null, transaction: pick(H), network: 'eip155:84532' }
    : kind === 'pending'
      ? { success: false, errorReason: PENDING, errorMessage: pick(MSG), transaction: pick(H), network: 'eip155:84532' }
      : { success: false, errorReason: pick(['insufficient_funds', 'invalid_transaction_state', 'x']), errorMessage: pick(MSG), transaction: '', network: 'eip155:84532' }
  const receipt = pick(['absent', 'shallow', 'deep', 'deep', 'deep', 'not_measured', 'reverted', 'reverted_shallow'])
  const amount = pick([price, price, price - 1n, price + 1n, 0n, 1n, price * 2n])
  const transfer = rnd() < 0.15 ? null : { to: pick([payTo, payTo, flip(payTo), '0x' + '2'.repeat(40)]), amount: String(amount < 0n ? 0n : amount), ...(rnd() < 0.1 ? {} : { nonce: pick([N1, N1, N2]) }) }
  const retry = pick([null, null, { sameAuthorization: true, hashFromNonceLookup: H[1] }, { sameAuthorization: false, hashFromNonceLookup: H[1] }])
  return { quote: { payTo, price: String(price) }, payment: { nonce: N1 }, response, chain: { receipt, transfer }, retry }
}

const nonceHash = (o) => (o.retry && o.retry.sameAuthorization ? o.retry.hashFromNonceLookup || '' : '')
const pendingWithHash = (o) => o.response.success === false && o.response.errorReason === PENDING && !!o.response.transaction
const adoptPath = (o) => pendingWithHash(o) || !!nonceHash(o)

const PROPS = {
  P1: ['never deliver on a named hash unless the chain is deep and the transfer is to us, for at least the price, and carries this payment\'s nonce', (o, d) => {
    if (!adoptPath(o) || d.outcome !== 'DELIVER') return true
    const t = o.chain.transfer
    return o.chain.receipt === 'deep' && !!t && low(t.to) === low(o.quote.payTo) && BigInt(t.amount) >= BigInt(o.quote.price) && t.nonce != null && low(t.nonce) === low(o.payment.nonce)
  }],
  P2: ['a reverted transaction is refused, a shallow reverted one is left open', (o, d) => {
    if (!adoptPath(o)) return true
    if (o.chain.receipt === 'reverted') return d.outcome === 'REFUSE'
    if (o.chain.receipt === 'reverted_shallow') return d.outcome === 'OPEN'
    return true
  }],
  P3: ['pending with no hash anywhere is open; another failure with no hash is refused', (o, d) => {
    if (adoptPath(o) || o.response.success === true) return true
    return o.response.errorReason === PENDING ? d.outcome === 'OPEN' : d.outcome === 'REFUSE'
  }],
  P4: ['the letter case of the recipient address never changes the outcome', (o, d, fn) => {
    if (!o.chain.transfer) return true
    const o2 = { ...o, chain: { ...o.chain, transfer: { ...o.chain.transfer, to: flip(o.chain.transfer.to) } } }
    return fn(o2).outcome === d.outcome
  }],
  P5: ['the error message text never changes the outcome, only the error code does', (o, d, fn) => {
    const m = /pend/i.test(o.response.errorMessage || '') ? 'Transaction failed' : 'settlement_pending: wait a moment'
    return fn({ ...o, response: { ...o.response, errorMessage: m } }).outcome === d.outcome
  }],
  P6: ['a larger transfer never turns a delivery into something else', (o, d, fn) => {
    if (d.outcome !== 'DELIVER' || !o.chain.transfer) return true
    const t = { ...o.chain.transfer, amount: String(BigInt(o.chain.transfer.amount) + 1n) }
    return fn({ ...o, chain: { ...o.chain, transfer: t } }).outcome === 'DELIVER'
  }],
  P7: ['the same observation gives the same answer twice', (o, d, fn) => JSON.stringify(fn(o)) === JSON.stringify(d)],
  P8: ['the receiver never settles a second time when the same payment comes back (field rule, not a spec rule)', (o, d) => d.secondSettle === false],
  P9: ['assumption: a plain success without an adopted hash is delivered at face value', (o, d) => !(o.response.success === true && !nonceHash(o)) || d.outcome === 'DELIVER'],
  P10: ['on a named hash, a chain that is absent, shallow or not measured means hold', (o, d) => !adoptPath(o) || !['absent', 'shallow', 'not_measured'].includes(o.chain.receipt) || d.outcome === 'HOLD'],
  P11: ['a named hash that is deep, to us, for enough and bound to this payment is delivered', (o, d) => {
    if (!adoptPath(o)) return true
    const t = o.chain.transfer
    const ok = o.chain.receipt === 'deep' && !!t && low(t.to) === low(o.quote.payTo) && BigInt(t.amount) >= BigInt(o.quote.price) && t.nonce != null && low(t.nonce) === low(o.payment.nonce)
    return !ok || d.outcome === 'DELIVER'
  }],
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
console.log(`random situations: ${N}, seed 20261122`)
const ref = run(decide)
const refBad = Object.entries(ref).filter(([, n]) => n)
console.log('reference violations:', refBad.length ? refBad.map(([k, n]) => `${k}=${n}`).join(' ') : 'none')

const set = JSON.parse(readFileSync(new URL('../../vectors/settlement-pending/vectors.json', import.meta.url), 'utf8'))
const asserted = set.vectors.filter((v) => v.asserted !== false)
const same = (a, b) => a.outcome === b.outcome && a.secondSettle === b.secondSettle
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
process.exit(refBad.length || neither ? 1 : 0)
