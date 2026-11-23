// Wrong twins: plausible seller implementations that each break exactly one rule. A vector set that
// cannot tell the reference from one of them is not testing that rule.
import { decide, decideWith, PENDING } from './decide.mjs'
const lower = (s) => String(s).toLowerCase()
const keep = (d, outcome) => ({ outcome, secondSettle: false, rule: d.rule })
export const TWINS = {
  'boolean-only (success false means refuse)': (o) => (o.response.success === false ? { outcome: 'REFUSE', secondSettle: false } : decide(o)),
  'fail-open (deliver while the chain has not confirmed)': (o) => {
    const d = decide(o)
    return d.outcome === 'HOLD' ? keep(d, 'DELIVER') : d
  },
  'matches on errorMessage instead of errorReason': (o) => {
    const msg = lower(o.response.errorMessage || '')
    const r = { ...o.response, errorReason: msg.includes('pending') ? PENDING : o.response.errorReason === PENDING ? 'x' : o.response.errorReason }
    return decide({ ...o, response: r })
  },
  'adopts the hash and delivers without looking at the chain': (o) => {
    const d = decide(o)
    const hash = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{64}$/.test(s)
    return d.outcome === 'HOLD' || d.outcome === 'REFUSE' ? (hash(o.response.transaction) || hash(o.retry?.hashFromNonceLookup) ? keep(d, 'DELIVER') : d) : d
  },
  'refuses instead of holding while unconfirmed': (o) => {
    const d = decide(o)
    return d.outcome === 'HOLD' ? keep(d, 'REFUSE') : d
  },
  'accepts any positive amount instead of at least the price': (o) => decideWith(o, { anyPositive: true }),
  'does not check the recipient': (o) => decideWith(o, { skipTo: true }),
  'compares addresses case sensitively': (o) => decideWith(o, { caseSensitive: true }),
  'settles again when the same payment comes back': (o) => ({ ...decide(o), secondSettle: !!o.retry }),
  'ignores the hash found by nonce': (o) => decide({ ...o, retry: null }),
  'holds even when the transfer is confirmed': (o) => {
    const d = decide(o)
    return d.outcome === 'DELIVER' && o.response.success === false ? keep(d, 'HOLD') : d
  },
  'treats an unreadable chain as a refusal': (o) => {
    const d = decide(o)
    return d.outcome === 'HOLD' && o.chain.receipt === 'not_measured' ? keep(d, 'REFUSE') : d
  },
  'does not check the authorization nonce (recipient and amount only)': (o) => decideWith(o, { skipNonce: true }),
  'holds on a reverted transaction as if it were still pending': (o) => {
    const d = decide(o)
    return d.rule === 'R04' ? keep(d, 'HOLD') : d
  },
  'compares amounts as floating point numbers': (o) => decideWith(o, { floatAmounts: true }),
  'asks for a nonce on the proof rail (refuses every smart-wallet buyer)': (o) => decideWith(o, { nonceOnProof: true }),
  'does not check the payer on the proof rail': (o) => decideWith(o, { skipPayer: true }),
  'does not claim the hash (delivers twice for one transfer)': (o) => decideWith(o, { skipClaim: true }),
  'does not check the token': (o) => decideWith(o, { skipToken: true }),
  'takes any non-empty string for a hash': (o) => decideWith(o, { anyString: true }),
}
