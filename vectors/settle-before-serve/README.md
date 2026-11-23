# x402 settle before serve: decision vectors for a paid endpoint (draft 1)

Cite as: github.com/holistis/agent-receipt-verify, vectors/settle-before-serve, 2026-11-23.

Status: draft 1. The fingerprint of vectors.json is 5c115ec59c59 (first 12 characters of its sha256).

## What this is

A paid endpoint receives a request with a PAYMENT-SIGNATURE header, asks a facilitator (and, in some designs, an on-chain fallback) to settle, and answers. The one thing it must never do is hand over the paid data without a confirmed settlement. Each vector is one observation (the header, what the facilitator returns, how long it takes, what the fallback returns) and the answer a careful seller gives: the HTTP status, whether it delivers the data, whether it calls the facilitator at all, and whether it built the data before the settle result was in.

## The hard invariant and the choices

The hard invariant: paid data is never delivered without a confirmed settlement. Every wrong implementation in src/settle-before-serve/twins.mjs makes a mistake against it or against one of the rules below.

Choices of this set, not requirements of any specification (basis "rec" in vectors.json):

- A header that cannot be parsed gets 400 and no facilitator call, and a missing header gets 402. The difference between 400 and 402 is our choice. The invariant holds with either, and one wrong implementation (always 402) is named as exactly that.
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

Rows A and B are the two cases that github.com/holistis supplied in that discussion (4 August and 15 September 2026). slowe89 mapped them into a table in a reply of 15 September 2026 under the name of a settle-before-serve bar (reject the unparseable, reject the failed settle, await the settle object before building the response), and added the race row (row D, serving before the settle returns); the bar and row D are his. That table is one reply in a thread. It is not a published matrix, and nothing here claims that the discussion adopted it.

## How to run

    node src/settle-before-serve/run.mjs           the reference against all vectors, then every wrong implementation
    node src/settle-before-serve/properties.mjs    10 properties over 20000 seeded random situations (--n=100000 for more)
    node src/settle-before-serve/selftest.mjs      plants 9 faults and checks that the two scripts above notice them
    npm run settle-before-serve                    all of the above in one go; npm test runs it as well

Tested with Node 24; the CI runs 20 and 22. No dependencies, no network.

## What was measured (23 November 2026)

- 15 vectors, 14 asserted, 1 open. The reference answers all 14 as expected.
- 8 wrong implementations, all caught by the vectors, each by at least 2 vectors.
- The same 8 are also caught by the properties, which do not use the vectors.
- The self test plants 9 faults (removed vectors, a changed answer, an empty list, a truncated file, three faults in the reference). All 9 are caught.

## What this does not show

- It is a model written and checked by one party. It is not an independent verification.
- It has not been run against a live facilitator or a real seller. What the facilitator and the fallback return is given in the observation, it is not computed, and the signature bytes in the example headers are placeholders.
- It tests a decision, not an implementation. A real server can be probed from outside with the requests of rows A and B and the answer compared. Row D, the race, cannot be seen from outside except through its harm: data that leaves before a failed settle. The wrong implementation that serves when the settle is slow models that harm with a threshold of one second.
- Only the header formats named in src/settle-before-serve/decide.mjs are recognized. Other payment schemes and other header names are out of scope.
