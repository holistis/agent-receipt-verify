#!/usr/bin/env node
// Decision table: lists every situation the model distinguishes, the answer of the reference and the rule behind it,
// and checks that every rule is reached by at least one vector and that the reference answers every situation.
//   node table.mjs            check the rules and the grid
//   node table.mjs --write    also write vectors/settlement-pending/decision-table.md
//   node table.mjs --check    also fail when decision-table.md is not what the grid and the vectors give now
// The grid is a model made by the authors. A situation that is not in it is not covered by this check.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decide, RULES } from './decide.mjs'

const set = JSON.parse(readFileSync(new URL('../../vectors/settlement-pending/vectors.json', import.meta.url), 'utf8'))
const low = (s) => String(s).toLowerCase()
const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13, 10)
const HASH = /^0x[0-9a-fA-F]{64}$/
const PAYTO = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'
const ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e', OTHER_TOKEN = '0x00000000000000000000000000000000000000d4'
const PAYER = '0x00000000000000000000000000000000000000c3', OTHER_PAYER = '0x00000000000000000000000000000000000000e5'
const N1 = '0x' + 'a1'.repeat(32), N2 = '0x' + 'b2'.repeat(32), H = '0x' + '1'.repeat(64), H2 = '0x' + '2'.repeat(64)

const RESP = ['success', 'pending+hash', 'pending-malformed-hash', 'pending-without-hash', 'other-error']
const RETRY = ['none', 'same-payment-again']
const RECEIPT = ['absent', 'not_measured', 'shallow', 'deep', 'reverted', 'reverted_shallow']
const TRANS = ['none', 'wrong-recipient', 'wrong-token', 'too-little', 'exact', 'exact-other-case', 'too-much']
const BIND = ['this-payment', 'other-payment', 'unreadable']
const RAIL = ['authorization', 'proof']
const CLAIM = ['none', 'delivered']

const classOf = (o) => {
  const r = o.response, t = o.chain.transfer, q = o.quote
  const resp = r.success === true ? 'success' : r.errorReason === 'settlement_pending' ? (!r.transaction ? 'pending-without-hash' : HASH.test(r.transaction) ? 'pending+hash' : 'pending-malformed-hash') : 'other-error'
  const retry = o.retry ? 'same-payment-again' : 'none'
  let tr = 'none', bind = '-'
  if (t) {
    tr = low(t.token) !== low(q.asset) ? 'wrong-token' : low(t.to) !== low(q.payTo) ? 'wrong-recipient' : BigInt(t.amount) < BigInt(q.price) ? 'too-little' : BigInt(t.amount) > BigInt(q.price) ? 'too-much' : t.to !== q.payTo ? 'exact-other-case' : 'exact'
    const proof = o.payment.rail === 'proof'
    const seen = proof ? t.from : t.nonce, want = proof ? o.payment.payer : o.payment.nonce
    bind = seen === undefined || seen === null ? 'unreadable' : low(seen) === low(want) ? 'this-payment' : 'other-payment'
  }
  return [resp, retry, o.chain.receipt, tr, bind, o.payment.rail, o.claims.hash].join(' | ')
}

// Which combinations exist at all. A chain that shows nothing has no transfer; a response without a usable hash and without
// a retry has no chain to look at; the proof rail has no facilitator response and no retry; a claim only matters once
// everything else would deliver. A plain success is delivered at face value (rule R01), so the chain is only sampled there.
const feasible = (resp, retry, receipt, tr, rail, claim) => {
  const adopt = resp === 'pending+hash' || retry === 'same-payment-again'
  if (['absent', 'not_measured', 'reverted', 'reverted_shallow'].includes(receipt) && tr !== 'none') return false
  if (resp === 'pending-malformed-hash' && retry !== 'none') return false
  if (!adopt && ['pending-malformed-hash', 'pending-without-hash', 'other-error'].includes(resp) && !['absent', 'not_measured'].includes(receipt)) return false
  if (resp === 'success' && retry === 'none' && !(tr === 'none' || tr === 'exact')) return false
  if (rail === 'proof' && !(resp === 'pending+hash' && retry === 'none')) return false
  if (claim === 'delivered' && !(adopt && receipt === 'deep' && ['exact', 'exact-other-case', 'too-much'].includes(tr))) return false
  return true
}

const build = (resp, retry, receipt, tr, bind, rail, claim) => {
  const response = resp === 'success'
    ? { success: true, errorReason: null, errorMessage: null, transaction: H, network: 'eip155:84532' }
    : resp === 'other-error'
      ? { success: false, errorReason: 'invalid_transaction_state', errorMessage: 'authorization already used', transaction: '', network: 'eip155:84532' }
      : { success: false, errorReason: 'settlement_pending', errorMessage: 'Receipt not found before timeout', transaction: resp === 'pending+hash' ? H : resp === 'pending-malformed-hash' ? 'not-a-hash' : '', network: 'eip155:84532' }
  const to = tr === 'wrong-recipient' ? '0x' + '2'.repeat(40) : tr === 'exact-other-case' ? PAYTO.toLowerCase() : PAYTO
  const amount = tr === 'too-little' ? '9999' : tr === 'too-much' ? '10001' : '10000'
  const proof = rail === 'proof'
  const seen = proof ? (bind === 'this-payment' ? PAYER : bind === 'other-payment' ? OTHER_PAYER : undefined) : (bind === 'this-payment' ? N1 : bind === 'other-payment' ? N2 : undefined)
  const transfer = tr === 'none' ? null : { to, amount, token: tr === 'wrong-token' ? OTHER_TOKEN : ASSET, ...(seen ? (proof ? { from: seen } : { nonce: seen }) : {}) }
  return {
    quote: { payTo: PAYTO, price: '10000', asset: ASSET }, payment: proof ? { rail, payer: PAYER } : { rail, nonce: N1 }, response,
    chain: { receipt, transfer }, retry: retry === 'none' ? null : { sameAuthorization: true, hashFromNonceLookup: H2 }, claims: { hash: claim },
  }
}

const rows = []
for (const resp of RESP) for (const retry of RETRY) for (const receipt of RECEIPT) for (const tr of TRANS) for (const rail of RAIL) for (const claim of CLAIM) {
  if (!feasible(resp, retry, receipt, tr, rail, claim)) continue
  const adopt = resp === 'pending+hash' || retry === 'same-payment-again'
  for (const bind of tr === 'none' ? ['-'] : adopt ? BIND : ['this-payment']) {
    if (claim === 'delivered' && bind !== 'this-payment') continue
    const obs = build(resp, retry, receipt, tr, bind, rail, claim)
    const key = classOf(obs)
    let d
    try { d = decide(obs) } catch (e) { d = { outcome: 'THROWS ' + e.message, rule: '??' } }
    rows.push({ key, outcome: d.outcome, rule: d.rule })
  }
}

const vecRule = new Map(), vecKey = new Map(), vecRuleKeys = new Map()
for (const v of set.vectors) {
  const d = decide(v.input), k = classOf(v.input), id = v.id.replace('x402-settlement-pending-', '')
  vecRule.set(d.rule, [...(vecRule.get(d.rule) || []), id])
  vecRuleKeys.set(d.rule, [...(vecRuleKeys.get(d.rule) || []), k])
  vecKey.set(k, [...(vecKey.get(k) || []), id])
}

let bad = 0
const throwing = rows.filter((r) => r.outcome.startsWith('THROWS'))
if (throwing.length) { bad++; console.log('REFERENCE THROWS on', throwing.length, 'situations, first:', throwing[0].key, throwing[0].outcome) }
const keys = rows.map((r) => r.key)
if (new Set(keys).size !== keys.length) { bad++; console.log('the grid lists the same situation twice') }
const gridKeys = new Set(keys)
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
// The rules that deliver (R12) or refuse a replay (R13) must be reached on every way a hash is adopted and on every rail the grid
// has for them: named in the response, or found by the nonce of a payment that comes back; authorization rail or proof rail.
const pathOf = (key) => { const p = key.split(' | '); return (p[0] === 'pending+hash' ? 'named in the response' : 'found by nonce') + ', ' + p[5] + ' rail' }
for (const id of ['R12', 'R13']) {
  const need = [...new Set(rows.filter((r) => r.rule === id).map((r) => pathOf(r.key)))].sort()
  const have = new Set((vecRuleKeys.get(id) || []).map(pathOf))
  const missing = need.filter((p) => !have.has(p))
  if (missing.length) { bad++; console.log(`${id}: NO VECTOR ON THESE WAYS IN: ${missing.join(' | ')}`) }
  else console.log(`${id}: a vector on every way in (${need.length}): ${need.join(' | ')}`)
}
const touched = rows.filter((r) => vecKey.has(r.key)).length
console.log(`situations touched by a vector: ${touched} of ${rows.length}. This is a map of blind spots, not a score: situations that share a rule are equivalent for the reference.`)

if (process.argv.includes('--write') || process.argv.includes('--check')) {
  const short = (a) => a.map((x) => x).join(', ')
  const lines = ['# Decision table (generated by src/settlement-pending/table.mjs --write, do not edit)', '',
    'Columns: response | same payment again | chain state | transfer | binding to this payment | rail | claim. Vectors listed are those whose situation matches exactly.', '',
    'Binding is the authorization nonce on the authorization rail and the payer address on the proof rail. A claim is a durable record that the hash was already delivered.', '',
    '## Rules', '', ...Object.entries(RULES).map(([id, t]) => `- ${id}: ${t}. Vectors: ${short(vecRule.get(id) || []) || 'none'}`), '',
    '## Situations', '', '| situation | answer | rule | vectors |', '|---|---|---|---|',
    ...rows.map((r) => `| ${r.key} | ${r.outcome} | ${r.rule} | ${short(vecKey.get(r.key) || [])} |`), '']
  const tekst = lines.join(LF)
  const pad = new URL('../../vectors/settlement-pending/decision-table.md', import.meta.url)
  if (process.argv.includes('--write')) {
    // Written to a temporary file and renamed, so that a check that runs at the same moment never reads half a file.
    const tmp = fileURLToPath(pad) + '.tmp-' + process.pid
    writeFileSync(tmp, tekst, 'utf8')
    renameSync(tmp, pad)
    console.log('decision-table.md written')
  }
  else {
    const staat = existsSync(pad) ? readFileSync(pad, 'utf8').split(CRLF).join(LF) : null
    if (staat !== tekst) { bad++; console.log('decision-table.md is missing or does not match what the grid and the vectors give now') }
    else console.log('decision-table.md matches the grid and the vectors')
  }
}
process.exit(bad ? 1 : 0)
