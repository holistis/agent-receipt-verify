# x402 settlement_pending: decision vectors for a seller (draft 3)

Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending, 2026-11-23.

Status: draft 3. The fingerprint of vectors.json is 35cce5965c97 (first 12 characters of its sha256).

This set does not say who retries. Every vector, except six (two failures that are not pending and carry no hash, and four with a missing or unusable hash), starts after the seller holds a hash: named in a settle response, named in a buyer's proof, or found by the nonce of a payment that comes back. Whether the seller retries the settle, or answers 425 and lets the buyer retry the request, is not encoded, because a reader will otherwise assume one of the two. One rule is a field rule and not a specification rule: when the same signed payment comes back, the transaction is found by its nonce and the payment is not settled again.

Two earlier drafts are kept unchanged next to this one, each with its own SHA256SUMS, so that anyone who noted their numbers can still check them:

- draft-2-frozen/ has the fingerprint 64568e264272
- draft-1-frozen/ has the fingerprint fd234a289755

## What this is

A seller that asks a facilitator to settle a payment can get back "settlement_pending": the transaction was broadcast and may still confirm. The x402 v2 specification (section 9) says this is not terminal and that the broadcast hash must be present. It does not say what the seller owes the payer in the meantime. Pull request 3437 in the x402 repo asks what a receiver owes the payer while a settlement is unresolved. Pull request 3545 is a test pull request: once the retry is exhausted and the outcome is still pending, the resource server returns 402, and it calls what to return instead a separate question that it refers to 3437. Both were open on 23 November 2026.

Each vector is one observation (what the seller received, what the chain shows, which rail paid, whether the hash was already delivered) and the answer a careful seller gives: DELIVER, HOLD or REFUSE. A case that nobody has settled is recorded as OPEN and is not asserted.

## Two rails, because the evidence differs

- Authorization rail (PAYMENT-SIGNATURE, EIP-3009). The signed payload carries the authorization, so a transfer is bound to this payment by its nonce.
- Proof rail (X-Payment-Proof). For buyers whose wallet cannot sign EIP-3009 (smart wallets, exchange withdrawals, passkey signers) there is no authorization nonce. The transfer is bound to this payment by its payer, which must equal the address that signed the proof, and by a durable claim of the transaction hash: one hash, one delivery, also after a restart.

A seller that asks for a nonce on the proof rail refuses every smart-wallet buyer; vector proof-rail-deliver and the wrong implementation that does it are there for that reason. On the proof rail the hash comes from the buyer's proof and not from a facilitator response; the observation models both as a named hash, and the decision after that is the same chain check with a different binding.

## What changed from draft 2

Two things changed, and they have different sources.

1. The binding differs per rail. This comes from the Slack message of mitaka7210 of 23 November 2026, not from running anything: he describes a nonce on the standard rail and, on the proof rail, which has no nonce, the payer address plus a durable claim of the transaction hash. Draft 2 knew only the nonce, and so would have left every proof-rail buyer open. Neither the nonce binding nor the payer binding is in his gist, so neither was measured against his code.
2. Several vectors now allow more than one answer (field acceptable in expected). This comes from the cross-run: his gist holds (it answers indeterminate) where the reference refuses a transfer that went to someone else, in another token, was too small, or is missing. Refusing and holding both leave the buyer without the data and the specification does not decide between them, so asserting one would claim more than is known. The reference always gives expected.outcome; a vector can never allow a delivery that the reference does not make (run.mjs fails on that). A transfer that belongs to another payment is allowed a hold on the same ground, the specification not deciding, and not because anything measured holds there: his gist delivers on such a transfer, because it has no binding.

What the cross-run showed (cross-run/README.md): his file has no binding of a transfer to a payment, compares amounts as floats, and holds where the reference refuses. The two answer differently on 19 of the 41 vectors: 8 are a different answer that the vector allows, 5 are open vectors where nothing is asserted, and 6 are outside what the vector allows.

New in draft 3: rules R13 (a hash that was already delivered is refused, also when the same payment comes back and the hash is found by nonce), R14 (another token than the quote), R15 (proof rail with an unreadable payer, open); a transaction string that is not 0x and 64 hex digits is no hash and is treated as missing (R03); 15 new vectors; 6 new wrong implementations (nonce asked on the proof rail, payer not checked, hash not claimed, hash not claimed when it is found by nonce, token not checked, any non-empty string taken for a hash).

Draft 2 had 26 vectors (3 open) and 15 wrong implementations. Draft 1 had 17 vectors (1 open) and 12.

## The cases and where they come from

- From Slack messages of mitaka7210 in the x402 community: the 425 hold and the same signed payment sent again with the transaction found by its nonce (an earlier message, its date was not kept in our notes); a reverted transaction as a terminal refusal and a hash that settled another payment (22 November 2026).
- From his Slack message of 23 November 2026: the two rails with their own binding, the payer binding on the proof rail, the durable claim. His production code is Kristo Intelligence, which his gist names as MIT; he describes the gist, owned by hristovdimitri2-hub, as "runnable, standard library only, MIT".
- The hold while the chain has not confirmed, the transfer checks and the number boundaries (one unit short, amounts above 2^53, 18 decimals, address letter case, near-miss addresses): this set, recommendations and not requirements of the specification. The basis of each vector is listed in vectors.json (spec, sdk, field, rec).

## Assumptions and open cases

- A plain success without a named hash is delivered at face value (rule R01). The facilitator is trusted for that path. His gist verifies the chain on success as well; this set does not require that. Nothing here tests a facilitator that lies about success.
- Pending without a usable hash (R03, including a string that is not a hash): open. Pull request 3437 would hold. mitaka7210 says his seller refuses (401), and his gist denies it. The specification does not decide it, so this set does not either. Two vectors for a malformed hash assert only that the seller does not hold on it and does not deliver; leaving it open or refusing are both fine. A third is recorded as open.
- Reverted but only a few blocks deep (R05): open. A reorganisation could still change the result. His gist denies a reverted transaction at any depth.
- Authorization rail with a nonce that cannot be read (R11) and proof rail with a payer that cannot be read (R15): open.
- The nonce is read from the same transaction, for example from the AuthorizationUsed event of an EIP-3009 token. That is not checked here against a live token.
- Recovery of a lost response (the effect ran, the buyer never got the answer) is outside this set. His gist handles it with a cached result; here a hash that was delivered is simply refused.

## Known deviation

mitaka7210 reported in the x402 Slack thread that their seller delivers after about 8 seconds when the settlement has still not confirmed, and called it a deliberate deviation. The set asserts the opposite (hold, vector receipt-absent-hold) and the wrong implementation "fail-open" is caught by 5 vectors.

## How to run

    node src/settlement-pending/run.mjs                the reference against all vectors, then every wrong implementation
    node src/settlement-pending/table.mjs --check      the decision table; fails if a rule has no vector, if R12 or R13 lacks a vector on one of the ways a hash is adopted, or if decision-table.md is out of date (--write regenerates it)
    node src/settlement-pending/properties.mjs         12 properties over 20000 seeded random situations (--n=100000 for more)
    node src/settlement-pending/selftest.mjs          plants 17 faults and checks that the three scripts above notice them
    npm run settlement-pending                         all of the above in one go; npm test runs it as well

Tested with Node 24. No dependencies, no network. The cross-run needs Python 3.12 and a copy of the gist file, and is not part of npm test: see cross-run/README.md.

## What was measured (23 November 2026)

- 41 vectors, 36 asserted, 5 open, 14 of them allowing more than one answer. The reference answers all 41 as expected.
- 21 wrong implementations, all caught by the vectors, none resting on a single vector. The same 21 are also caught by the properties, which do not use the vectors. Each wrong implementation makes one mistake (it relaxes one check or changes one behaviour); one behaviour can decide several situations, so a wrong implementation can show up under more than one rule id.
- The decision table has 284 situations and 15 rules. Every rule is reached by at least one vector, and R12 (deliver) and R13 (refuse a replay) are reached on every way a hash is adopted and on every rail the grid has for them. Only 32 of the 284 situations are hit by a vector. Situations that share a rule are equivalent for the reference, so this is a map of blind spots and not a score.
- The self test plants 17 faults: removed vectors (four faults), a changed answer, an answer widened to allow a delivery, an empty list, a truncated file, and nine faults in the reference (nonce binding, payer binding, claim, claim only on the path where the hash is named, token, reverted, amounts as numbers, nonce asked on the proof rail, hash taken from any string). All 17 are caught, and the fault in the claim on the retry path is noticed by the vectors, the properties and the decision table each on their own.
- The cross-run (cross-run/README.md): 36 asserted vectors answered by the decision logic of the gist of mitaka7210: 22 get the same answer, 8 get a different answer that the vector allows, 6 get a delivery that the vector does not allow, all 6 about things that his file does not contain (the binding of a transfer to a payment, and float amounts). 5 open vectors, nothing asserted.

## What this does not show

- It was written and checked by one party. The cross-run is one run of one adapter that we wrote; it is not an independent verification, and it is not a verification of the production code of the seller whose gist was used.
- The grid of situations and the properties are a model made by the same authors. A situation that is not in the model is not covered.
- The nonce binding, the payer binding and the amounts are not checked against a live token or live transactions.
- The set tests the decision after a hash is held. It does not test the facilitator, the chain reader, or what a seller does after delivering.
