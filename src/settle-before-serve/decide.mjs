// Reference decision for a seller that receives a request with a PAYMENT-SIGNATURE header and must answer: which status,
// whether it delivers the paid data, whether it calls the facilitator, and whether it built the data before the settle result was in.
// Pure function over one observation. No network, no clock, no randomness. The facilitator and the on-chain fallback are not
// called here: what they would return is part of the observation.
//
// The hard invariant: paid data is never delivered without a confirmed settlement. Everything else is a choice, and the choices
// are marked in vectors.json (basis "rec").
//   S01 no header: 402, nothing delivered, no facilitator call.
//   S02 a header that is neither a transaction hash nor base64 JSON with a version and a payload: 400, nothing delivered,
//       no facilitator call. The split between 400 here and 402 for S01 is our choice, not part of the invariant.
//   S03 the facilitator confirms the settlement: 200 with data, built only after the settle result is in.
//   S04 the facilitator does not confirm but the on-chain fallback does: 200 with data, same rule.
//   S05 nothing confirms (the facilitator refused, failed or did not answer, and the fallback did not confirm): 402, nothing delivered.
//       A settle result that was logged and not acted on is the fault this family exists for.
//   S06 an empty header value: open (absent or unparseable?), nothing delivered.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.
export const TX_HASH = /^0x[0-9a-fA-F]{64}$/
const out = (status, delivers, callsFacilitator, builtBeforeSettle, rule) => ({ status, delivers, callsFacilitator, builtBeforeSettle, rule })

// 'absent', 'empty', 'unparseable' or 'wellformed'. Wellformed means a transaction hash or base64 JSON (standard or URL alphabet)
// that is an object with a numeric x402Version and an object payload. Whether the signature inside is valid is not decided here.
export function parseHeader(v) {
  if (v === null || v === undefined) return 'absent'
  if (v === '') return 'empty'
  if (TX_HASH.test(v)) return 'wellformed'
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) return 'unparseable'
  try {
    const j = JSON.parse(Buffer.from(v.split('-').join('+').split('_').join('/'), 'base64').toString('utf8'))
    const ok = j && typeof j === 'object' && typeof j.x402Version === 'number' && j.payload && typeof j.payload === 'object'
    return ok ? 'wellformed' : 'unparseable'
  } catch { return 'unparseable' }
}

export const decide = (obs) => decideWith(obs, {})

// decideWith is only for the wrong twins: each twin relaxes exactly one thing, so it breaks exactly one rule.
// relax: unparseableIsPaid, facilitatorFirst, unparseableAs402, serveOnTimeout, buildFirst, errorIsSuccess, ignoreFallback, serveOnSettleFailure.
export function decideWith(obs, relax) {
  const h = parseHeader(obs.paymentSignature)
  if (h === 'absent') return out(402, false, false, false, 'S01')
  if (h === 'empty') return out('OPEN', false, false, false, 'S06')
  if (h === 'unparseable') {
    if (relax.unparseableIsPaid) return out(200, true, false, false, 'S02')
    return out(relax.unparseableAs402 ? 402 : 400, false, !!relax.facilitatorFirst, false, 'S02')
  }
  const f = obs.facilitator.result
  const late = obs.facilitator.latencyMs > 1000
  if (relax.buildFirst) return out(200, true, true, true, 'S03')
  if (relax.serveOnTimeout && late) return out(200, true, true, true, 'S03')
  if (f === 'success' || (relax.errorIsSuccess && f === 'error')) return out(200, true, true, false, 'S03')
  if (obs.fallback === 'confirmed' && !relax.ignoreFallback) return out(200, true, true, false, 'S04')
  if (relax.serveOnSettleFailure) return out(200, true, true, false, 'S05')
  return out(402, false, true, false, 'S05')
}

export const RULES = {
  S01: 'no header: 402, nothing delivered, the facilitator is not called',
  S02: 'a header that cannot be parsed: 400, nothing delivered, the facilitator is not called',
  S03: 'the facilitator confirms the settlement: 200 with data, built after the settle result',
  S04: 'the facilitator does not confirm, the on-chain fallback does: 200 with data, built after the confirmation',
  S05: 'nothing confirms (refused, failed, unknown or forged): 402, nothing delivered',
  S06: 'an empty header value: open',
}
