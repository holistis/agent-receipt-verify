// Reference decision for a seller that receives a SettleResponse and must choose: deliver, hold, refuse or leave open.
// Pure function over one observation. No network, no clock, no randomness.
//
// Basis, per rule (see vectors.json for the basis of each case):
//   spec   x402 v2 specification section 9: settlement_pending is non-terminal and must carry the broadcast hash.
//   sdk    @x402/core 2.29.0 settleWithPendingRetry: one retry with the same payload, no delivery in between.
//   field  mitaka7210 / kristo-intelligence-6 (MIT): 425 hold, same signed payment sent again, hash found by nonce;
//          a reverted transaction is terminal and refused; a hash that settled someone else's payment is refused.
//   rec    recommendation of this pack, not a MUST of the spec: hold while the chain does not confirm,
//          verify that the transfer to our own payTo is for at least the price AND belongs to this payment
//          (same authorization nonce) before delivering.
//
// Assumption, stated so nobody has to guess: a plain success=true without an adopted hash is delivered at face value.
// The facilitator is trusted for that path. Nothing in this set tests a facilitator that lies about success.
//
// Each answer carries a rule id (R01 to R12) so that tabel.mjs can show which rules the vectors reach.
export const PENDING = 'settlement_pending'
const lower = (s) => String(s).toLowerCase()
const out = (outcome, rule) => ({ outcome, secondSettle: false, rule })

export const decide = (obs) => decideWith(obs, {})

// decideWith is only for the wrong twins: each twin relaxes exactly one check, so it breaks exactly one rule.
// relax: skipTo, anyPositive, caseSensitive, floatAmounts, skipNonce. The reference is decide(), never relaxed.
export function decideWith(obs, relax) {
  const r = obs.response
  const pending = r.success === false && r.errorReason === PENDING
  const nonceHash = obs.retry && obs.retry.sameAuthorization ? obs.retry.hashFromNonceLookup || '' : ''
  const adopted = pending ? r.transaction || nonceHash : nonceHash
  if (r.success === true && !adopted) return out('DELIVER', 'R01')
  if (!pending && !adopted) return out('REFUSE', 'R02')
  if (!adopted) return out('OPEN', 'R03')
  const c = obs.chain
  if (c.receipt === 'reverted') return out('REFUSE', 'R04')
  if (c.receipt === 'reverted_shallow') return out('OPEN', 'R05')
  if (c.receipt !== 'deep') return out('HOLD', 'R06')
  const t = c.transfer
  if (!t) return out('REFUSE', 'R07')
  const norm = relax.caseSensitive ? String : lower
  if (!relax.skipTo && norm(t.to) !== norm(obs.quote.payTo)) return out('REFUSE', 'R08')
  const num = (x) => (relax.floatAmounts ? BigInt(Number(x)) : BigInt(x))
  const short = relax.anyPositive ? num(t.amount) <= 0n : num(t.amount) < num(obs.quote.price)
  if (short) return out('REFUSE', 'R09')
  if (!relax.skipNonce) {
    if (t.nonce === undefined || t.nonce === null) return out('OPEN', 'R11')
    if (lower(t.nonce) !== lower(obs.payment.nonce)) return out('REFUSE', 'R10')
  }
  return out('DELIVER', 'R12')
}

export const RULES = {
  R01: 'success without an adopted hash: deliver at face value (facilitator trusted)',
  R02: 'not pending and no hash anywhere: refuse',
  R03: 'pending without a hash, nothing to adopt: open (spec silent, PR 3437 would hold)',
  R04: 'mined and reverted: terminal, refuse',
  R05: 'reverted but still shallow: a reorg could change it, open',
  R06: 'chain absent, shallow or not measured: hold',
  R07: 'confirmed but no transfer: refuse',
  R08: 'transfer went to someone else: refuse',
  R09: 'transfer smaller than the price: refuse',
  R10: 'transfer to us for enough, but it belongs to another payment: refuse',
  R11: 'transfer fine but its nonce cannot be read, so it cannot be bound to this payment: open',
  R12: 'confirmed, to us, enough, and bound to this payment: deliver',
}
