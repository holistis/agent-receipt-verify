# x402 settlement_pending: decision vectors for a seller (draft 3)

Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending, 2026-11-23.

Status: draft 3. The fingerprint of vectors.json is e59fd5017b32 (first 12 characters of its sha256).

This set does not say who retries. Every vector starts after the seller holds a named transaction hash, from a settle response or from a buyer's proof. Whether the seller retries the settle, or answers 425 and lets the buyer retry the request, is not encoded, because a reader will otherwise assume one of the two. One rule is a field rule and not a specification rule: when the same signed payment comes back, the transaction is found by its nonce and the payment is not settled again.

Two earlier drafts are kept unchanged next to this one, each with its own SHA256SUMS, so that anyone who noted their numbers can still check them:

- draft-2-frozen/ has the fingerprint 64568e264272
- draft-1-frozen/ has the fingerprint fd234a289755

## What this is

A seller that asks a facilitator to settle a payment can get back "settlement_pending": the transaction was broadcast and may still confirm. The x402 v2 specification (section 9) says this is not terminal and that the broadcast hash must be present. It does not say what the seller owes the payer in the meantime. Two open pull requests in the x402 repo (3437 and 3545) ask exactly that.

Each vector is one observation (what the seller received, what the chain shows, which rail paid, whether the hash was already delivered) and the answer a careful seller gives: DELIVER, HOLD or REFUSE. A case that nobody has settled is recorded as OPEN and is not asserted.

## Two rails, because the evidence differs

- Authorization rail (PAYMENT-SIGNATURE, EIP-3009). The signed payload carries the authorization, so a transfer is bound to this payment by its nonce.
- Proof rail (X-Payment-Proof). For buyers whose wallet cannot sign EIP-3009 (smart wallets, exchange withdrawals, passkey signers) there is no authorization nonce. The transfer is bound to this payment by its payer, which must equal the address that signed the proof, and by a durable claim of the transaction hash: one hash, one delivery, also after a restart.

A seller that asks for a nonce on the proof rail refuses every smart-wallet buyer; vector proof-rail-deliver and the wrong implementation that does it are there for that reason. On the proof rail the hash comes from the buyer's proof and not from a facilitator response; the observation models both as a named hash, and the decision after that is the same chain check with a different binding.

## What changed from draft 2

Two things, both found by running a second implementation over the same text (see cross-run/):

1. The binding differs per rail (above). Draft 2 knew only the nonce, and so would have left every proof-rail buyer open.
2. Several vectors now allow more than one answer (field acceptable in expected). For a transfer that is to someone else, in another token, too small, or that belongs to another payment, the reference refuses, and a seller that keeps holding is also fine. Delivering is wrong. The two implementations that were compared differ exactly here (the reference refuses, the deployed seller holds), and the specification does not decide it, so asserting one would claim more than is known. The reference always gives expected.outcome; a vector can never allow a delivery that the reference does not make (run.mjs fails on that).

New in draft 3: rules R13 (a hash that was already delivered is refused), R14 (another token than the quote), R15 (proof rail with an unreadable payer, open); a transaction string that is not 0x and 64 hex digits is no hash and is treated as missing (R03); 13 new vectors; 5 new wrong implementations (nonce asked on the proof rail, payer not checked, hash not claimed, token not checked, any non-empty string taken for a hash).

Draft 2 had 26 vectors (3 open) and 15 wrong implementations. Draft 1 had 17 vectors (1 open) and 12.

## The cases and where they come from

- 425 hold, the same signed payment sent again, the transaction found by its nonce; a reverted transaction as a terminal refusal; a hash that settled another payment; the two rails with their own binding; the durable claim: mitaka7210 (production code of Kristo Intelligence, MIT; runnable gist owned by hristovdimitri2-hub), field behaviour of a deployed seller.
- The hold while the chain has not confirmed, the transfer checks and the number boundaries (one unit short, amounts above 2^53, 18 decimals, address letter case, near-miss addresses): this set, recommendations and not requirements of the specification. The basis of each vector is listed in vectors.json (spec, sdk, field, rec).

## Assumptions and open cases

- A plain success without a named hash is delivered at face value (rule R01). The facilitator is trusted for that path. One deployed seller verifies the chain on success as well; this set does not require that. Nothing here tests a facilitator that lies about success.
- Pending without a usable hash (R03, including a string that is not a hash): open. Pull request 3437 would hold, one deployed seller refuses. The specification does not decide it, so this set does not either. Two vectors for a malformed hash assert only that the seller does not adopt it and keep holding on it.
- Reverted but only a few blocks deep (R05): open. A reorganisation could still change the result. One deployed seller refuses at any depth.
- Authorization rail with a nonce that cannot be read (R11) and proof rail with a payer that cannot be read (R15): open.
- The nonce is read from the same transaction, for example from the AuthorizationUsed event of an EIP-3009 token. That is not checked here against a live token.
- Recovery of a lost response (the effect ran, the buyer never got the answer) is outside this set. A deployed seller handles it with a cached result; here a hash that was delivered is simply refused.

## Known deviation

mitaka7210 reported in the x402 Slack thread that their seller delivers after 8 seconds when the settlement has still not confirmed, and called this a deviation themselves. The set asserts the opposite (hold, vector receipt-absent-hold) and the wrong implementation "fail-open" is caught by 5 vectors.

## How to run

    node src/settlement-pending/run.mjs                the reference against all vectors, then every wrong implementation
    node src/settlement-pending/table.mjs --check      the decision table; fails if a rule has no vector or decision-table.md is out of date (--write regenerates it)
    node src/settlement-pending/properties.mjs         12 properties over 20000 seeded random situations (--n=100000 for more)
    node src/settlement-pending/selftest.mjs          plants 15 faults and checks that the three scripts above notice them
    npm run settlement-pending                         all of the above in one go; npm test runs it as well

Tested with Node 24. No dependencies, no network. The cross-run needs Python 3.12 and a copy of the gist file, and is not part of npm test: see cross-run/README.md.

## What was measured (23 November 2026)

- 39 vectors, 34 asserted, 5 open, 14 of them allowing more than one answer. The reference answers all 39 as expected.
- 20 wrong implementations, all caught by the vectors, none resting on a single vector. The same 20 are also caught by the properties, which do not use the vectors.
- The decision table has 284 situations and 15 rules. Every rule is reached by at least one vector. Only 30 of the 284 situations are hit by a vector. Situations that share a rule are equivalent for the reference, so this is a map of blind spots and not a score.
- The self test plants 15 faults (removed vector, changed answer, an answer widened to allow a delivery, empty list, truncated file, and eight faults in the reference: nonce binding, payer binding, claim, token, reverted, amounts as numbers, nonce asked on the proof rail, hash taken from any string). All 15 are caught.
- The cross-run (cross-run/README.md): 34 asserted vectors judged by the decision logic of the gist of mitaka7210: 20 get the same answer, 8 get a different answer that the vector allows, 6 get a delivery that the vector does not allow, all 6 about things that his file does not contain (the binding of a transfer to a payment, and float amounts). 5 open vectors, nothing asserted.

## What this does not show

- It was written and checked by one party. The cross-run is one run of one adapter that we wrote; it is not an independent verification, and it is not a verification of the production code of the seller whose gist was used.
- The grid of situations and the properties are a model made by the same authors. A situation that is not in the model is not covered.
- The nonce binding, the payer binding and the amounts are not checked against a live token or live transactions.
- The set tests the decision after a hash is named. It does not test the facilitator, the chain reader, or what a seller does after delivering.
