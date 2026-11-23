#!/usr/bin/env node
// Decision table: lists every situation the model distinguishes, the answer of the reference and the rule behind it,
// and checks that every rule is reached by at least one vector and that the reference answers every situation.
//   node table.mjs            check the rules and the grid
//   node table.mjs --write    also write vectors/settlement-pending/decision-table.md
//   node table.mjs --check    also fail when decision-table.md is not what the grid and the vectors give now
// The grid is a model made by the authors. A situation that is not in it is not covered by this check.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { decide, RULES } from './decide.mjs'

const set = JSON.parse(readFileSync(new URL('../../vectors/settlement-pending/vectors.json', import.meta.url), 'utf8'))
const low = (s) => String(s).toLowerCase()
const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13, 10)
const PAYTO = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'
const N1 = '0x' + 'a1'.repeat(32), N2 = '0x' + 'b2'.repeat(32), H = '0x' + '1'.repeat(64), H2 = '0x' + '2'.repeat(64)

const RESP = ['success', 'pending+hash', 'pending-without-hash', 'other-error']
const RETRY = ['none', 'same-payment-again']
const RECEIPT = ['absent', 'not_measured', 'shallow', 'deep', 'reverted', 'reverted_shallow']
const TRANS = ['none', 'wrong-recipient', 'too-little', 'exact', 'exact-other-case', 'too-much']
const NONCE = ['this-payment', 'other-payment', 'unreadable']

const classOf = (o) => {
  const r = o.response, t = o.chain.transfer, q = o.quote
  const resp = r.success === true ? 'success' : r.errorReason === 'settlement_pending' ? (r.transaction ? 'pending+hash' : 'pending-without-hash') : 'other-error'
  const retry = o.retry ? 'same-payment-again' : 'none'
  let tr = 'none', nc = '-'
  if (t) {
    tr = low(t.to) !== low(q.payTo) ? 'wrong-recipient' : BigInt(t.amount) < BigInt(q.price) ? 'too-little' : BigInt(t.amount) > BigInt(q.price) ? 'too-much' : t.to !== q.payTo ? 'exact-other-case' : 'exact'
    nc = t.nonce === undefined || t.nonce === null ? 'unreadable' : low(t.nonce) === low(o.payment.nonce) ? 'this-payment' : 'other-payment'
  }
  return [resp, retry, o.chain.receipt, tr, nc].join(' | ')
}

const feasible = (resp, retry, receipt, tr) => {
  if (['absent', 'not_measured', 'reverted', 'reverted_shallow'].includes(receipt) && tr !== 'none') return false
  if ((resp === 'pending-without-hash' || resp === 'other-error') && retry === 'none' && !['absent', 'not_measured'].includes(receipt)) return false
  // A plain success is delivered at face value (rule R01), so the chain is only sampled, not enumerated.
  if (resp === 'success' && retry === 'none' && !(tr === 'none' || tr === 'exact')) return false
  return true
}

const build = (resp, retry, receipt, tr, nc) => {
  const response = resp === 'success'
    ? { success: true, errorReason: null, errorMessage: null, transaction: H, network: 'eip155:84532' }
    : resp === 'other-error'
      ? { success: false, errorReason: 'invalid_transaction_state', errorMessage: 'authorization already used', transaction: '', network: 'eip155:84532' }
      : { success: false, errorReason: 'settlement_pending', errorMessage: 'Receipt not found before timeout', transaction: resp === 'pending+hash' ? H : '', network: 'eip155:84532' }
  const to = tr === 'wrong-recipient' ? '0x' + '2'.repeat(40) : tr === 'exact-other-case' ? PAYTO.toLowerCase() : PAYTO
  const amount = tr === 'too-little' ? '9999' : tr === 'too-much' ? '10001' : '10000'
  const nonce = nc === 'this-payment' ? N1 : nc === 'other-payment' ? N2 : undefined
  const transfer = tr === 'none' ? null : { to, amount, ...(nonce ? { nonce } : {}) }
  return { quote: { payTo: PAYTO, price: '10000' }, payment: { nonce: N1 }, response, chain: { receipt, transfer }, retry: retry === 'none' ? null : { sameAuthorization: true, hashFromNonceLookup: H2 } }
}

const rows = []
for (const resp of RESP) for (const retry of RETRY) for (const receipt of RECEIPT) for (const tr of TRANS) {
  if (!feasible(resp, retry, receipt, tr)) continue
  for (const nc of tr === 'none' ? ['-'] : NONCE) {
    const obs = build(resp, retry, receipt, tr, nc)
    const key = classOf(obs)
    let d
    try { d = decide(obs) } catch (e) { d = { outcome: 'THROWS ' + e.message, rule: '??' } }
    rows.push({ key, outcome: d.outcome, rule: d.rule })
  }
}

const vecRule = new Map(), vecKey = new Map()
for (const v of set.vectors) {
  const d = decide(v.input), k = classOf(v.input), id = v.id.replace('x402-settlement-pending-', '')
  vecRule.set(d.rule, [...(vecRule.get(d.rule) || []), id])
  vecKey.set(k, [...(vecKey.get(k) || []), id])
}

let bad = 0
const throwing = rows.filter((r) => r.outcome.startsWith('THROWS'))
if (throwing.length) { bad++; console.log('REFERENCE THROWS on', throwing.length, 'situations, first:', throwing[0].key, throwing[0].outcome) }
const gridKeys = new Set(rows.map((r) => r.key))
const outside = [...vecKey.keys()].filter((k) => !gridKeys.has(k))
if (outside.length) { bad++; console.log('vectors outside the grid (the grid is incomplete):', outside) }

console.log(`situations in the grid: ${rows.length}, answered by the reference: ${rows.length - throwing.length}`)
console.log('rule | situations | vectors')
for (const id of Object.keys(RULES)) {
  const n = rows.filter((r) => r.rule === id).length
  const vs = vecRule.get(id) || []
  if (n === 0) { bad++; console.log(`${id} | 0 | ${vs.length}  RULE NEVER REACHED BY THE GRID`) }
  else if (vs.length === 0) { bad++; console.log(`${id} | ${n} | 0  NO VECTOR REACHES THIS RULE`) }
  else console.log(`${id} | ${n} | ${vs.length}`)
}
const touched = rows.filter((r) => vecKey.has(r.key)).length
console.log(`situations touched by a vector: ${touched} of ${rows.length}. This is a map of blind spots, not a score: situations that share a rule are equivalent for the reference.`)

if (process.argv.includes('--write') || process.argv.includes('--check')) {
  const short = (a) => a.map((x) => x).join(', ')
  const lines = ['# Decision table (generated by src/settlement-pending/table.mjs --write, do not edit)', '',
    'Columns: response | same payment again | chain state | transfer | nonce. Vectors listed are those whose situation matches exactly.', '',
    '## Rules', '', ...Object.entries(RULES).map(([id, t]) => `- ${id}: ${t}. Vectors: ${short(vecRule.get(id) || []) || 'none'}`), '',
    '## Situations', '', '| situation | answer | rule | vectors |', '|---|---|---|---|',
    ...rows.map((r) => `| ${r.key} | ${r.outcome} | ${r.rule} | ${short(vecKey.get(r.key) || [])} |`), '']
  const tekst = lines.join(LF)
  const pad = new URL('../../vectors/settlement-pending/decision-table.md', import.meta.url)
  if (process.argv.includes('--write')) { writeFileSync(pad, tekst, 'utf8'); console.log('decision-table.md written') }
  else {
    const staat = existsSync(pad) ? readFileSync(pad, 'utf8').split(CRLF).join(LF) : null
    if (staat !== tekst) { bad++; console.log('decision-table.md is missing or does not match what the grid and the vectors give now') }
    else console.log('decision-table.md matches the grid and the vectors')
  }
}
process.exit(bad ? 1 : 0)
