// Offline re-check of three paid x402 calls and the acceptance records issued for them.
// Node standard library only, no network. Run: node reproduce.mjs
//
// What this does: for each purchase it recomputes, from the stored files alone, the
// things a reader would otherwise have to take on trust. What it does NOT do is listed
// in README.md under "Not checked here" (time-stamp tokens, the chain, the checker's
// independence). A check that cannot fail is not a check: test/live-paid-call.mjs plants
// faults in every input and requires the matching check to turn red.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// RFC 8785 for the JSON this folder deals with: object keys sorted by UTF-16 code units,
// numbers and strings as JSON.stringify writes them (ECMAScript number-to-string).
export function jcs(v) {
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

export const sha256hex = (bytesOrString) => crypto.createHash('sha256').update(bytesOrString).digest('hex')

const cents = (x) => Math.round(x * 100)
const FIELDS = ['endpoint', 'result', 'provenance', 'summary', 'meta']

// The seller's rule for provenance.responseHash, named by the Golden Vector Provenance
// project as GVP-FixedPoint/2 and confirmed here on every body by recomputation.
// `inputs` is the JSON request body the buyer sent, not body.result.inputs: the seller wrote
// on x402#2887 (17 November 2026) that result.inputs equals it only when the request already
// held every field, and its responses now say so in provenance.hashRule.
export function responseHashOf(body, requestInput) {
  if (requestInput === undefined) throw new Error('responseHashOf needs the request body that was sent')
  const members = {
    endpoint: body.endpoint,
    inputs: requestInput,
    result: body.result,
    method: body.provenance.method,
    dataVintage: body.provenance.dataVintage,
  }
  return 'sha256:' + sha256hex(jcs(members))
}

// The criteria that were committed before payment, re-evaluated from the body by us.
// Keyed by the criteria_set string that is inside the committed document.
const EVALUATORS = {
  'x402toll-paycheck-acceptance': (b) => {
    const r = b.result
    const gold = r.inputs && r.inputs.salary === 85000 && r.inputs.state === 'TX' &&
      r.inputs.filingStatus === 'single' && r.inputs.payFrequency === 'biweekly'
    return {
      c1: FIELDS.every((f) => f in b),
      c2: Boolean(gold) && r.netPerCheck === 2639.52,
      c3: Boolean(gold) && r.federalTax === 9870 && r.ficaTotal === 6502.5,
    }
  },
  'x402toll-paycheck-arithmetic': (b) => {
    const r = b.result
    return {
      c1: FIELDS.every((f) => f in b),
      c2: cents(r.federalTax + r.stateTax + r.ficaTotal) === cents(r.totalTax),
      c3: cents(r.socialSecurity + r.medicare + r.additionalMedicare) === cents(r.ficaTotal),
      c4: cents(r.inputs.salary - r.totalTax) === cents(r.netAnnual),
      c5: cents(r.netAnnual / r.periodsPerYear) === cents(r.netPerCheck),
    }
  },
}

export function loadFixtures(dir = path.join(HERE, 'fixtures')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  const rd = (f) => fs.readFileSync(path.join(dir, f))
  return {
    seller: manifest.seller,
    keys: JSON.parse(rd('checker-keys.json').toString('utf8')),
    purchases: manifest.purchases.map((p) => ({
      ...p,
      bodyBytes: rd(p.body),
      criteriaBytes: rd(p.criteria),
      record: JSON.parse(rd(p.record).toString('utf8')),
    })),
  }
}

function check(out, id, ok, detail) {
  out.push({ id, ok: Boolean(ok), detail: detail || '' })
}

function ed25519Verifies(publicKeyBase64, message, signatureBase64) {
  try {
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyBase64, 'base64')])
    const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signatureBase64, 'base64'))
  } catch {
    return false
  }
}

// Returns { ok, results: [{ purchase, checks: [{ id, ok, detail }] }] }.
// Every step is wrapped: a malformed input turns the matching check red, it never throws.
export function verifyAll(data) {
  const results = []
  for (const p of data.purchases) {
    const checks = []
    let body = null
    let receipt = null
    let sidecar = null
    try { body = JSON.parse(Buffer.from(p.bodyBytes).toString('utf8')) } catch { body = null }
    try { receipt = p.record.record.receipt; sidecar = p.record.bindings_sidecar } catch { receipt = null }

    check(checks, 'body-is-json', body && typeof body === 'object', 'the stored body parses as JSON')

    try {
      const f = receipt.files.remediated
      check(checks, 'deliverable-sha256',
        sha256hex(p.bodyBytes) === f.sha256 && Buffer.byteLength(p.bodyBytes) === f.bytes,
        'sha256 and length of the stored body equal what the record judged')
    } catch { check(checks, 'deliverable-sha256', false, 'record has no files.remediated') }

    try {
      const id = sha256hex(p.criteriaBytes)
      check(checks, 'criteria-sha256', id === receipt.criteria.sha256 && id === sidecar.criteria_id,
        'sha256 of the committed criteria document equals the id in the record and in its sidecar')
    } catch { check(checks, 'criteria-sha256', false, 'record has no criteria id') }

    try {
      const h = sha256hex(jcs(receipt))
      check(checks, 'receipt-sha256', h === p.receiptSha256 && h === sidecar.receipt_sha256,
        'sha256 of the JCS form of record.receipt equals the id the checker issued')
    } catch { check(checks, 'receipt-sha256', false, 'record has no receipt') }

    try {
      const published = (data.keys.keys || []).find((k) => k.key_id === receipt.key_id)
      const inRecord = (p.record.keys.keys || []).find((k) => k.key_id === receipt.key_id)
      check(checks, 'signature',
        Boolean(published) && Boolean(inRecord) && published.public_key_base64 === inRecord.public_key_base64 &&
        ed25519Verifies(published.public_key_base64, jcs(receipt), p.record.record.signature.value),
        'Ed25519 over the JCS receipt verifies with the published checker key, and the record carries the same key')
    } catch { check(checks, 'signature', false, 'no signature or key to check') }

    try {
      check(checks, 'hash-rule', responseHashOf(body, p.input) === body.provenance.responseHash,
        'provenance.responseHash recomputed over {endpoint, request as sent, result, method, dataVintage}')
    } catch { check(checks, 'hash-rule', false, 'body lacks the members the rule needs') }

    try {
      const set = JSON.parse(Buffer.from(p.criteriaBytes).toString('utf8'))
      const evalFn = EVALUATORS[set.criteria_set]
      const mine = evalFn(body)
      const required = receipt.results.filter((r) => r.required)
      const same = required.length === set.criteria.length &&
        set.criteria.every((c) => {
          const rec = receipt.results.find((r) => r.id === c.id)
          return rec && rec.required && (rec.result === 'pass') === (mine[c.id] === true)
        })
      check(checks, 'criteria-recomputed', same && set.criteria.every((c) => mine[c.id] === true),
        'each committed criterion re-evaluated from the body by this script, and equal to the record\'s result')
      const allPass = set.criteria.every((c) => mine[c.id] === true)
      check(checks, 'verdict', receipt.verdict === (allPass ? 'pass' : 'fail') && receipt.verdict === 'pass',
        'the record\'s verdict agrees with our own evaluation')
    } catch { check(checks, 'criteria-recomputed', false, 'criteria or results unreadable'); check(checks, 'verdict', false, 'no verdict to compare') }

    try {
      check(checks, 'payee',
        String(receipt.parties.producer.key_id).toLowerCase() === (data.seller.network + ':' + data.seller.payTo).toLowerCase(),
        'the record names the seller\'s payTo address as producer')
    } catch { check(checks, 'payee', false, 'record names no producer') }

    try {
      check(checks, 'tx-named', String(receipt.client_ref).toLowerCase().includes(p.tx.slice(0, 18).toLowerCase()),
        'the record\'s client_ref names this purchase\'s transaction')
    } catch { check(checks, 'tx-named', false, 'record has no client_ref') }

    results.push({ purchase: p.n, checks })
  }
  const ok = results.length > 0 && results.every((r) => r.checks.every((c) => c.ok))
  return { ok, results }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = verifyAll(loadFixtures())
  for (const r of out.results) {
    console.log('purchase ' + r.purchase)
    for (const c of r.checks) console.log('  ' + (c.ok ? 'ok  ' : 'FAIL') + '  ' + c.id.padEnd(20) + c.detail)
  }
  console.log(out.ok ? '\nall checks passed' : '\nat least one check FAILED')
  process.exitCode = out.ok ? 0 : 1
}
