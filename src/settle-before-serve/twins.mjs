// Wrong twins: plausible seller implementations that each break exactly one rule. A vector set that
// cannot tell the reference from one of them is not testing that rule.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.
import { decideWith } from './decide.mjs'
export const TWINS = {
  'serves paid data when the settle failed, it only logs it': (o) => decideWith(o, { serveOnSettleFailure: true }),
  'treats an unrecognized header as paid': (o) => decideWith(o, { unparseableIsPaid: true }),
  'calls the facilitator before validating the header locally': (o) => decideWith(o, { facilitatorFirst: true }),
  'answers 402 instead of 400 for an unparseable header (our choice, not the invariant)': (o) => decideWith(o, { unparseableAs402: true }),
  'serves without waiting when the settle is slow (race on the await)': (o) => decideWith(o, { serveOnTimeout: true }),
  'builds the data before it asks the facilitator to settle': (o) => decideWith(o, { buildFirst: true }),
  'treats a facilitator error or timeout as a success': (o) => decideWith(o, { errorIsSuccess: true }),
  'ignores a settlement the on-chain fallback confirmed': (o) => decideWith(o, { ignoreFallback: true }),
}
