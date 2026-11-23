# x402 settlement_pending: decision vectors for a seller (draft 2)

Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending, 2026-11-23.

Status: draft 2. The fingerprint of vectors.json is 64568e264272 (first 12 characters of its sha256). Draft 1 had the fingerprint fd234a289755 and is kept unchanged in draft-1-frozen/ with its own SHA256SUMS, so that anyone who noted that number can check it. The credit line inside vectors.json says "nothing published" because it was written on 22 November 2026, before this directory existed; the file is kept byte for byte so that the fingerprint stays valid.

## What this is

A seller that asks a facilitator to settle a payment can get back "settlement_pending": the transaction was broadcast and may still confirm. The x402 v2 specification (section 9) says this is not terminal and that the broadcast hash must be present. It does not say what the seller owes the payer in the meantime. Two open pull requests in the x402 repo (3437 and 3545) ask exactly that.

Each vector is one observation (what the seller received, what the chain shows) and the answer a careful seller gives: DELIVER, HOLD or REFUSE. A case that nobody has settled is recorded as OPEN and is not asserted.

## What changed from draft 1

Draft 1 had 17 vectors and 12 wrong implementations (not republished here as a family; only its vectors.json is kept, frozen). A message from mitaka7210 on 22 November 2026 showed two gaps in it, both measured here:

1. A transaction that was mined and reverted is terminal and must be refused. The reference of draft 1 knew no such state and would have held it.
2. A hash that names a real, confirmed transfer to the seller for the right amount can still belong to another payment. Checking recipient and amount only, as draft 1 did, would deliver. Draft 2 also requires that the transfer carries the authorization nonce of this payment.

Draft 2 has 26 vectors (3 open) and 15 wrong implementations.

## The cases and where they come from

- 425 hold, the same signed payment sent again, the transaction found by its nonce: mitaka7210 / kristo-intelligence-6 (MIT), field behaviour of a deployed seller.
- A hash that settled another payment, and a reverted transaction as a terminal refusal: mitaka7210, same source.
- The hold while the chain has not confirmed, the transfer checks and the number boundaries (one unit short, amounts above 2^53, address letter case): this set, recommendations and not requirements of the specification. The basis of each vector is listed in vectors.json (spec, sdk, field, rec).

## Assumptions and open cases

- A plain success without a named hash is delivered at face value. The facilitator is trusted for that path. Nothing here tests a facilitator that lies about success.
- Pending without any hash (rule R03): open. Pull request 3437 would hold, one deployed seller refuses today. The specification does not decide it, so this set does not either.
- Reverted but only a few blocks deep (R05): open. A reorganisation could still change the result.
- Transfer fine, but its nonce cannot be read from the transaction (R11): open.
- The nonce is read from the same transaction, for example from the AuthorizationUsed event of an EIP-3009 token. That is not checked here against a live token.
- Who retries the settle is not encoded. Every vector starts after the seller received a settle response. One rule is a field rule and not a specification rule: when the same signed payment comes back, the seller finds the transaction by its nonce and does not settle again.

## Known deviation

mitaka7210 reported in the x402 Slack thread that their seller delivers after 8 seconds when the settlement has still not confirmed, and called this a deviation themselves. The set asserts the opposite (hold, vector receipt-absent-hold) and the wrong implementation "fail-open" is caught by 5 vectors.

## How to run

    node src/settlement-pending/run.mjs                the reference against all vectors, then every wrong implementation
    node src/settlement-pending/table.mjs --check      the decision table; fails if a rule has no vector or decision-table.md is out of date (--write regenerates it)
    node src/settlement-pending/properties.mjs         11 properties over 20000 seeded random situations (--n=100000 for more)
    node src/settlement-pending/selftest.mjs          plants 9 faults and checks that the three scripts above notice them
    npm run settlement-pending                         all of the above in one go; npm test runs it as well

Tested with Node 24. No dependencies, no network.

## What was measured (22 November 2026)

- 26 vectors, 23 asserted, 3 open. The reference answers all 23 as expected.
- 15 wrong implementations, all caught by the vectors (13 by 2 or more vectors, 2 by one vector each: reverted treated as pending, amounts compared as floating point).
- The same 15 are also caught by the properties, which do not use the vectors.
- The decision table has 196 situations and 12 rules. Every rule is reached by at least one vector. Only 20 of the 196 situations are hit by a vector. Situations that share a rule are equivalent for the reference, so this is a map of blind spots and not a score.
- The self test plants 9 faults (removed vector, changed answer, empty list, truncated file, three faults in the reference). All 9 are caught.

## What this does not show

- It was written and checked by one party. It is not an independent verification. The port into this repository changed no vector and no number.
- The grid of situations and the properties are a model made by the same authors. A situation that is not in the model is not covered. Running other implementations over the same vectors is how that gets tested, and nobody has done it yet.
- The nonce binding and the amounts are not checked against a live token or live transactions.
