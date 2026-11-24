# x402 settle before serve: decision vectors for a paid endpoint (draft 1)

Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.

Status: draft 1. The fingerprint of vectors.json is 5c115ec59c59 (first 12 characters of its sha256).

These vectors are for sellers. They are not part of the buyer-side conformance check of this package.

## What this is

A paid endpoint receives a request with a PAYMENT-SIGNATURE header, asks a facilitator (and, in some designs, an on-chain fallback) to settle, and answers. The one thing it must never do is hand over the paid data without a confirmed settlement. Each vector is one observation (the header, what the facilitator returns, how long it takes, what the fallback returns) and the answer this set records for a seller: the HTTP status, whether it delivers the data, whether it calls the facilitator at all, and whether it built the data before the settle result was in.

## The hard invariant and the choices

The hard invariant: paid data is never delivered without a confirmed settlement. Every wrong implementation in src/settle-before-serve/twins.mjs makes a mistake against it or against one of the rules below.

Choices of this set, not requirements of any specification (basis "rec" in vectors.json):

- A header that cannot be parsed gets 400 and no facilitator call, and a missing header gets 402. 400 against 402 is the choice of this set. It is not part of x402 v2 and not part of the hard rule, and the hard rule is: never deliver data without a confirmed settle. A seller that answers 402 for an unparseable header keeps the hard rule and still fails the vectors of row A, because this set records 400 there; the wrong implementation that always answers 402 is named as exactly that.
- A bare transaction hash (0x and 64 hex digits) in PAYMENT-SIGNATURE counts as well-formed in this model. x402 v2 does not define a header like that; it is how the seller of github.com/holistis behaved, the seller that rows A to C of this set come from. A seller that follows the specification and refuses such a header fails vector facilitator-error-fallback-confirms-200, which uses one.
- A settlement confirmed by the on-chain fallback counts like one confirmed by the facilitator.
- An empty header value is open. Nothing is delivered either way.

## The rows

| Row | Input | Answer | Vectors |
|---|---|---|---|
| none | no header | 402, no data, no facilitator call | no-header-402 |
| A | a header that is not a payment (not a transaction hash, not base64 JSON with a version and a payload) | 400, no data, no facilitator call, even if the facilitator would have said yes | 4 junk-header vectors |
| B | a well-formed transferWithAuthorization with a forged signature; the facilitator refuses and the fallback fails on signature recovery | 402, no data | forged-signature-402 |
| C | the settle failed, or errored, or never answered, and the fallback did not confirm; the result was only logged | 402, no data | settle-failed-logged-only-402, settle-unknown-timeout-402, both-paths-fail-402 |
| D | the settle answer is late (1500 ms) and later succeeds or fails | the data is built only after the settle result: 200 with data when it succeeds, 402 and no data when it fails | late-settle-success-200, late-settle-failure-402 |
| ordinary | well-formed header, settle confirmed (by the facilitator or by the fallback) | 200 with data | 3 vectors |
| open | an empty header value | not settled | empty-header-open |

## Where the cases come from

Rows A, B and C come from a production fault in the seller of github.com/holistis (August 2026): the settle result was logged and never acted on, and an unrecognized payment header was treated as though payment had succeeded. Both were fixed. The request was a 400 for the junk header and a 402 for the forged signature, with the 400 coming from local parsing before any facilitator call.

Rows A and B are the two cases that github.com/holistis supplied in discussion 2436 of modelcontextprotocol/modelcontextprotocol (https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2436) on 4 August and 15 September 2026. slowe89 mapped them into a table in a reply of 15 September 2026 under the name of a settle-before-serve bar (reject the unparseable, reject the failed settle, await the settle object before building the response), and added the race row (row D, serving before the settle returns); the bar and row D are his. That table is one reply in a thread. It is not a published matrix, and nothing here claims that the discussion adopted it.

## What the basis field means

Every vector in vectors.json lists where its case comes from:

- field: a case from the production fault of github.com/holistis (August 2026) or from a message in discussion 2436 of modelcontextprotocol/modelcontextprotocol, not measured here against any seller.
- rec: a choice or recommendation of this set, not a requirement of any specification.

## Run the set against your own implementation

Write a module that exports decide(observation) and give its path to the runner:

    // my-seller.mjs
    export function decide(obs) {
      // obs has paymentSignature, facilitator { result, latencyMs } and fallback, as in vectors.json
      return { status: 402, delivers: false, callsFacilitator: false, builtBeforeSettle: false }
    }

    node src/settle-before-serve/run.mjs --impl ./my-seller.mjs

The answer is the four fields status, delivers, callsFacilitator and builtBeforeSettle. An asserted vector passes when all four equal the expected answer; this is what matches() in src/settle-before-serve/decide.mjs does. A vector with asserted set to false is open: its answer is shown and never fails. The exit code is 0 when every asserted vector passes, 1 when one fails and 2 when the module cannot be loaded or does not export decide.

## An observation that is not well formed

decide() throws an error that starts with "invalid observation:" and names the field, for a facilitator result other than success, failed or error, a latency that is not a non-negative number, a fallback other than not_tried, failed or confirmed, a header that is not text, and a missing facilitator. It never answers with delivered data for such an observation. properties.mjs plants 11 defects and checks that every one is refused.

## How to run

    node src/settle-before-serve/run.mjs           the reference against all vectors, then every wrong implementation (--impl <module> runs your own)
    node src/settle-before-serve/properties.mjs    10 properties over 20000 seeded random situations (--n=100000 for more)
    node src/settle-before-serve/selftest.mjs      plants 10 faults and checks that the two scripts above notice them
    npm run settle-before-serve                    all of the above in one go; npm test runs it as well

Tested with Node 24; the CI runs 20 and 22. No dependencies, no network.

## What was measured (23 November 2026)

- 15 vectors, 14 asserted, 1 open. The reference answers all 14 as expected.
- 8 wrong implementations, all caught by the vectors, each by at least 2 vectors.
- The same 8 are also caught by the properties, which do not use the vectors.
- The self test plants 10 faults (removed vectors, a changed answer, an empty list, a truncated file, four faults in the reference). All 10 are caught.

## What this does not show

- It is a model written and checked by one party. It is not an independent verification.
- It has not been run against a live facilitator or a real seller. What the facilitator and the fallback return is given in the observation, it is not computed, and the signature bytes in the example headers are placeholders.
- It tests a decision, not an implementation. A real server can be probed from outside with the requests of rows A and B and the answer compared. Row D, the race, cannot be seen from outside except through its harm: data that leaves before a failed settle. The wrong implementation that serves when the settle is slow models that harm with a threshold of one second.
- Simultaneous requests with the same header are outside the scope of this set; every observation is one request.
- Only the header formats named in src/settle-before-serve/decide.mjs are recognized. Other payment schemes and other header names are out of scope.
