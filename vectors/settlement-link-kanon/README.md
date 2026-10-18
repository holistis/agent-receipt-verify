# The settlement-link vectors, in Kanon's shape

This directory is generated. Do not edit the files by hand; run
`node tools/naar-kanon-vorm.mjs` and commit the result. `npm test` checks that what is
on disk is byte-identical to what the converter would write today, so a stale copy
cannot sit here unnoticed.

## Why it exists

The author of the Kanon vectors wrote in
[x402#3396](https://github.com/x402-foundation/x402/issues/3396) on 17 October 2026:

> if you want receipt-to-settlement vectors in Kanon's shape, I'm open to that, with the
> part that needs a chain read marked as such.

This is that. The source corpus lives in `../settlement-link` and is the same twelve
cases; these are the same cases in their field layout, with the chain-reading one
marked.

## What these cover, and what they do not

Kanon covers the buyer's authorization **before** settlement: validity window, signature
malleability, domain replay across chain and contract, nonce reuse, amount. These cover
the other end: does a salted commitment inside a **signed receipt** open onto exactly one
settlement on chain. The two sets nowhere overlap, which is why this is a complement and
not a merge, and why every file here carries `verifies: "receipt-to-settlement"`.

That also means Kanon's existing runner cannot execute these as they stand. Their input
is `payload.authorization`; ours is a receipt plus a salt plus an asset. The shape is
theirs so the two corpora can sit in one place and be read by one reader. The content is
a different axis, and pretending otherwise would waste somebody's afternoon.

## The two fields we added, both additive

- `verifies` — which axis the vector tests. Without it, two corpora in one directory are
  indistinguishable.
- `requires_chain_read` — present and `true` on exactly one vector. The other eleven run
  offline, with no account, no key and no network. A runner that does not know this field
  ignores it; a runner that does knows to expect an RPC.

## The one place the shape does not fit, and it is the interesting one

Kanon's `expected` is `{ valid, reason_code }`. Three of our four outcomes map onto that
cleanly:

| our outcome | expected |
|---|---|
| `LINKED` | `valid: true`, `reason_code: LINKED` |
| `NOT_LINKED` | `valid: false`, `reason_code: NOT_LINKED` |
| `AMBIGUOUS` | `valid: false`, `reason_code: AMBIGUOUS` |
| `NOT_MEASURED` | **no `valid` at all**, `measurable: false` |

The fourth has no slot, and we left the hole visible rather than filling it. A receipt
whose candidate set could not be obtained has not been rejected: our chain read did not
happen, and that says nothing about the receipt. Writing `valid: false` there would
blame an honest seller for our own failed RPC. A missing field is a question for a
reader; a false is an accusation.

That is the third-outcome gap the same thread discussed, and the Kanon author said in
the same comment he would look at adding an optional third outcome without weakening the
accept and reject cases. One file in this directory is what that gap looks like in
practice: `no-candidates-not-measured.json`.

## Provenance

The Kanon vectors themselves are in `../kanon`, pinned at commit `0d5a7461e996`,
Apache-2.0, redistributed unmodified with attribution. The vectors here are ours, built
from three real payments on Base Sepolia; the receipts, salts and nonces in them are real
and the commitments re-derive from the signed receipts rather than being copied in.
