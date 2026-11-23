// Reference decision for a seller that holds a named transaction hash and must choose: deliver, hold, refuse or leave open.
// Pure function over one observation. No network, no clock, no randomness.
// An observation that is not well formed is never guessed at: decide() throws an error that starts with "invalid observation:" and names the
// field, so an unknown rail, an unknown claim status, an unknown chain state or a price that is not a string of digits can never end in DELIVER.
// A missing claims object counts, explicitly, as claims.hash "none".
//
// Basis, per rule (see vectors.json for the basis of each case):
//   spec   x402 v2 specification section 9: settlement_pending is non-terminal and must carry the broadcast hash.
//   sdk    @x402/core 2.29.0 settleWithPendingRetry: one retry with the same payload, no delivery in between.
//   field  mitaka7210, in messages in the x402 community Slack and in a runnable gist owned by hristovdimitri2-hub (the licence of the gist is its author's): 425 hold,
//          the same signed payment sent again with the transaction found by its nonce, a reverted transaction is terminal,
//          a hash that settled another payment is refused, two payment rails with a different binding each, and a durable
//          claim so that one hash gives one delivery.
//   rec    recommendation of this pack, not a MUST of the spec: hold while the chain does not confirm, and verify that the
//          transfer is in the quoted token, to our own payTo, for at least the price, and belongs to this payment.
//
// Two rails, because the evidence differs:
//   authorization  the buyer signed an EIP-3009 authorization; the transfer is bound to this payment by its nonce.
//   proof          the buyer presents a transaction hash (X-Payment-Proof) because the wallet cannot sign EIP-3009
//                  (smart wallets, exchange withdrawals, passkeys). There is no nonce, so the transfer is bound to this
//                  payment by its payer, which must equal the address that signed the proof. A seller that asks for a
//                  nonce on this rail refuses every smart-wallet buyer.
// On both rails a hash that was already delivered is claimed durably and is never delivered a second time.
// On the proof rail the hash comes from the buyer's proof and not from a facilitator response; the observation models both as
// a named hash and the decision after that is the same chain check with a different binding.
//
// Assumption, stated so nobody has to guess: a plain success=true without an adopted hash is delivered at face value.
// The facilitator is trusted for that path. One deployed seller verifies the chain on success too; this set does not require it.
// Nothing in this set tests a facilitator that lies about success.
//
// Each answer carries a rule id (R01 to R15) so that table.mjs can show which rules the vectors reach.
export const PENDING = 'settlement_pending'
const lower = (s) => String(s).toLowerCase()
const out = (outcome, rule) => ({ outcome, secondSettle: false, rule })
const HASH = /^0x[0-9a-fA-F]{64}$/
const unreadable = (x) => x === undefined || x === null
const RECEIPTS = ['absent', 'not_measured', 'shallow', 'deep', 'reverted', 'reverted_shallow']
const invalid = (field) => { throw new Error('invalid observation: ' + field) }
const text = (x) => typeof x === 'string' && x.trim().length > 0
const digits = (x) => typeof x === 'string' && /^\d+$/.test(x)

// Fail closed: check every field the decision reads before reading it. Whether an amount, a hash or a nonce is the right one is decided
// below; here it is only decided that the observation is something a decision can be taken on at all.
export function validate(obs) {
  if (!obs || typeof obs !== 'object') invalid('observation')
  if (!obs.response || typeof obs.response !== 'object' || typeof obs.response.success !== 'boolean') invalid('response.success')
  const q = obs.quote
  if (!q || typeof q !== 'object') invalid('quote')
  if (!text(q.payTo)) invalid('quote.payTo')
  if (!digits(q.price)) invalid('quote.price')
  if (!text(q.asset)) invalid('quote.asset')
  const p = obs.payment
  if (!p || typeof p !== 'object' || (p.rail !== 'authorization' && p.rail !== 'proof')) invalid('payment.rail')
  if (p.rail === 'authorization' && !text(p.nonce)) invalid('payment.nonce')
  if (p.rail === 'proof' && !text(p.payer)) invalid('payment.payer')
  if (obs.claims !== undefined && (obs.claims === null || typeof obs.claims !== 'object' || (obs.claims.hash !== 'none' && obs.claims.hash !== 'delivered'))) invalid('claims.hash')
  if (!obs.chain || typeof obs.chain !== 'object' || !RECEIPTS.includes(obs.chain.receipt)) invalid('chain.receipt')
  const t = obs.chain.transfer
  if (t !== null && t !== undefined) {
    if (typeof t !== 'object') invalid('chain.transfer')
    if (!text(t.to)) invalid('chain.transfer.to')
    if (!text(t.token)) invalid('chain.transfer.token')
    if (!digits(t.amount)) invalid('chain.transfer.amount')
  }
  if (obs.retry !== undefined && obs.retry !== null && (typeof obs.retry !== 'object' || Array.isArray(obs.retry))) invalid('retry')
}

// A vector may allow more than one answer (field acceptable): for a transfer that does not belong to this payment a seller
// may refuse or keep holding, and delivering is wrong. The reference always gives expected.outcome.
export const matches = (got, expected) =>
  (expected.acceptable ? expected.acceptable.includes(got.outcome) : got.outcome === expected.outcome) && got.secondSettle === expected.secondSettle

export const decide = (obs) => decideWith(obs, {})

// decideWith is only for the wrong twins: each twin makes one mistake (relaxes one check or changes one behaviour). One behaviour can decide several situations, so a twin can show up under more than one rule id.
// relax: skipTo, anyPositive, caseSensitive, floatAmounts, skipNonce, nonceOnProof, skipPayer, skipClaim, skipClaimOnRetry, skipToken, anyString.
// The reference is decide(), never relaxed.
export function decideWith(obs, relax) {
  validate(obs)
  if (obs.claims === undefined) obs = { ...obs, claims: { hash: 'none' } }
  const r = obs.response
  const isHash = (s) => (relax.anyString ? !!s : typeof s === 'string' && HASH.test(s))
  const pending = r.success === false && r.errorReason === PENDING
  const nonceHash = obs.retry && obs.retry.sameAuthorization && isHash(obs.retry.hashFromNonceLookup) ? obs.retry.hashFromNonceLookup : ''
  const named = pending && isHash(r.transaction) ? r.transaction : ''
  const adopted = pending ? named || nonceHash : nonceHash
  if (r.success === true && !adopted) return out('DELIVER', 'R01')
  if (!pending && !adopted) return out('REFUSE', 'R02')
  if (!adopted) return out('OPEN', 'R03')
  const c = obs.chain
  if (c.receipt === 'reverted') return out('REFUSE', 'R04')
  if (c.receipt === 'reverted_shallow') return out('OPEN', 'R05')
  if (c.receipt !== 'deep') return out('HOLD', 'R06')
  const t = c.transfer
  if (!t) return out('REFUSE', 'R07')
  if (!relax.skipToken && lower(t.token) !== lower(obs.quote.asset)) return out('REFUSE', 'R14')
  const norm = relax.caseSensitive ? String : lower
  if (!relax.skipTo && norm(t.to) !== norm(obs.quote.payTo)) return out('REFUSE', 'R08')
  const num = (x) => (relax.floatAmounts ? BigInt(Number(x)) : BigInt(x))
  const short = relax.anyPositive ? num(t.amount) <= 0n : num(t.amount) < num(obs.quote.price)
  if (short) return out('REFUSE', 'R09')
  if (obs.payment.rail === 'proof' && !relax.nonceOnProof) {
    if (!relax.skipPayer && unreadable(t.from)) return out('OPEN', 'R15')
    if (!relax.skipPayer && lower(t.from) !== lower(obs.payment.payer)) return out('REFUSE', 'R10')
  } else if (!relax.skipNonce) {
    if (unreadable(t.nonce)) return out('OPEN', 'R11')
    if (lower(t.nonce) !== lower(obs.payment.nonce)) return out('REFUSE', 'R10')
  }
  if (!relax.skipClaim && !(relax.skipClaimOnRetry && !named) && obs.claims && obs.claims.hash === 'delivered') return out('REFUSE', 'R13')
  return out('DELIVER', 'R12')
}

export const RULES = {
  R01: 'success without an adopted hash: deliver at face value (facilitator trusted)',
  R02: 'not pending and no hash anywhere: refuse',
  R03: 'pending without a usable hash (missing, or not 0x and 64 hex digits), nothing to adopt: open (spec silent, PR 3437 would hold)',
  R04: 'mined and reverted: terminal, refuse',
  R05: 'reverted but still shallow: a reorg could change it, open',
  R06: 'chain absent, shallow or not measured: hold',
  R07: 'confirmed but no transfer: refuse or keep holding, never deliver',
  R08: 'transfer went to someone else: refuse or keep holding, never deliver',
  R09: 'transfer smaller than the price: refuse or keep holding, never deliver',
  R10: 'transfer to us for enough, but it belongs to another payment (other nonce on the authorization rail, other payer on the proof rail): refuse or keep holding, never deliver',
  R11: 'authorization rail: transfer fine but its nonce cannot be read, so it cannot be bound to this payment: open',
  R12: 'confirmed, in the quoted token, to us, enough, bound to this payment and not delivered before: deliver',
  R13: 'this hash was already delivered (durable claim): refuse, never a second delivery',
  R14: 'transfer is in another token than the quote: refuse or keep holding, never deliver',
  R15: 'proof rail: transfer fine but its payer cannot be read, so it cannot be bound to this payment: open',
}
