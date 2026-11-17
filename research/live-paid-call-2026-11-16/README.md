# A paid x402 call, checked end to end

Cite as: github.com/holistis/agent-receipt-verify, research/live-paid-call-2026-11-16, 16 November 2026.

Three real purchases from a seller we do not control (x402toll.com, /v1/paycheck, 0.05 USDC each on Base mainnet). Before each payment the acceptance criteria were committed to a time-stamping service. After payment an outside checker (invinoveritas) judged the delivered body against those criteria and signed a record. This folder holds every file needed to re-check that chain offline, and a script that does it.

    node research/live-paid-call-2026-11-16/reproduce.mjs

Node standard library only, no network. It prints ten checks per purchase and exits non-zero if any fails.

## Three purchases

| Purchase | Request | Transaction | Criteria committed | Record binds |
|---|---|---|---|---|
| 1 | TX, salary 85000, single, biweekly | 0xc7d40f93b99c5d6ff0e8679b0ad42057b575bc49462095a6d4ad0002f05af8a0 | 13:51:21Z (set 1, three criteria taken from the seller's own published golden vector) | our JCS re-serialization of the body, not the bytes of the response |
| 2 | FL, salary 75000, single, biweekly | 0xd8f2a444b4959e98c0126c845ecf1ffc54cbc81f9ac09fe8afbfd781ecb1b6ce | 20:15:24Z (set 2, five arithmetic criteria) | the response body saved before parsing |
| 3 | CA, salary 120000, single, biweekly | 0xea6b33df18d066f7caddc0e36ddd08104b63e65f722dec00764529ff805aed51 | 20:15:24Z (set 2) | the response body saved before parsing |

All times are 16 November 2026, UTC. Records were issued at 20:04:55Z, 20:25:38Z and 20:25:42Z. Total spend: 0.15 USDC.

Purchase 1 was made before we saved raw bodies. That limit was pointed out by the checker, and purchases 2 and 3 were made with the body saved first.

## Ten checks per purchase

Per purchase:

1. Body parses as JSON.
2. Sha256 and length of the body equal what the record says it judged.
3. Committed criteria document hashes to the criteria id in the record and in its sidecar.
4. JCS form of the record's receipt hashes to the id the checker issued.
5. Ed25519 signature over that JCS form verifies with the checker's published key, and the record carries the same key.
6. Seller's own hash, provenance.responseHash, recomputes from the request recorded in manifest.json (see below).
7. Each committed criterion, re-evaluated from the body by the script, agrees with the record's result.
8. Verdict agrees with that evaluation.
9. Producer field names the seller's payTo address.
10. Client_ref names this purchase's transaction.

test/live-paid-call.mjs plants 28 faults in the bodies, records, criteria, keys and manifest and requires the matching check to turn red. node test/mutatie-live-paid-call.mjs does the reverse: it breaks the script itself, one check at a time, and requires the test to turn red each time.

## Seller's hash rule

Each response carries provenance.responseHash and provenance.fixedPointVersion (GVP-FixedPoint/2). The response does not say what the hash covers. The Golden Vector Provenance project, https://github.com/SolomonisBlack/golden-vector-provenance, names the hashed members. Recomputed with our own code, this matches the seller's value on all three bodies:

    "sha256:" + hex(SHA-256(JCS({endpoint, inputs, result, method, dataVintage})))

with endpoint = body.endpoint, inputs = the JSON request body the buyer sent, result = body.result, method = body.provenance.method, dataVintage = body.provenance.dataVintage. The operator of the checker reproduced it independently with their own JCS code on the same three bodies: https://github.com/x402-foundation/x402/issues/2887#issuecomment-6929632540

Correction, 17 November 2026. An earlier version of this page, and our own comment on x402#2887, gave inputs = body.result.inputs. That equals the request only when the request already held every field. SolomonisBlack, who publishes the Golden Vector Provenance spec, wrote on x402#2887 that inputs is the request body as sent, and that the seller's responses now state the rule in provenance.hashRule: https://github.com/x402-foundation/x402/issues/2887#issuecomment-6935775924 . The free sample at https://x402toll.com/v1/sample/paycheck shows it. We sent all four fields in all three purchases, so no number here changed. The case of a request with fewer fields is the seller's statement: we did not test it with a purchase, and the test for it uses a synthetic body. The three recorded bodies predate hashRule and do not carry it.

By this rule summary, meta and the rest of provenance sit outside the hash. A body with an edited summary still passes the hash and is caught only by the binding in the record. The test pins this boundary in both directions.

## Coverage by piece

| Piece | Covers |
|---|---|
| Seller's responseHash | endpoint, inputs, result, method, dataVintage |
| Records 2 and 3 | the whole saved body, including summary, meta and the rest of provenance |
| Record 1 | our JCS re-serialization of the whole body |

This table follows the checker operator's own summary in the thread linked above.

## Not checked here

- RFC 3161 and OpenTimestamps tokens. Records and sidecars carry them, and the order in time (criteria before payment) rests on the checker's statement and on those tokens, which this script does not validate.
- Anything on the chain: that each transaction exists, in which block, and that it moved 0.05 USDC to the seller. Checking this is something the checker's records say they did.
- The signature on the record's sidecar.
- That the saved bytes are what the seller sent. Our script writes the response text before parsing it, but nobody else observed the wire, so purchases 2 and 3 are bound to the bytes we saved.

## Limits of the claim

- Independence. A record declares the checker independent. The acceptance-binding module in this repository classifies these records as LABELS_VERSCHILLEN: the checker's key id and the producer's key id differ, but nothing in a record proves the seller does not control the checker's key. We know of no link between them and cannot show there is none.
Update, 17 November 2026: a fourth purchase, on our own route and with a producer key we hold, produced a record that the same module reads as BEWEZEN_ONAFHANKELIJK. It is kept as vectors/acceptance-binding/real-record-producer-signed-live.json. The three records on this page stay as they are, at LABELS_VERSCHILLEN.

- No person looked at these deliveries, according to the records themselves. The validator field reads "invinoveritas work-acceptance checker v0 (gpt-5.6-terra); extraction: utf-8 text" and the human_review block says not-performed.
- We chose the purchases, wrote the criteria and wrote this page, so none of that is independent of us. Independent of us are the signed records and the recomputation of the hash rule by the checker's operator.
- Three purchases, one seller, one endpoint, a deterministic function. This says nothing about other sellers.

## Files

- fixtures/purchase-1-body.jcs.json, purchase-2-body.raw.json, purchase-3-body.raw.json: the bodies as described above.
- fixtures/criteria-1.jcs.json, criteria-2.jcs.json: the committed criteria documents in JCS form.
- fixtures/records/: the three records as served by the checker.
- fixtures/checker-keys.json: the checker's published key document.
- fixtures/manifest.json: which file belongs to which purchase, with the transactions and the seller's payTo.
- .gitattributes: stops line-ending conversion on the evidence files. A converted checkout changes the hashes.

The records, keys and response bodies are third-party outputs, reproduced here so the checks can run offline. They are not our work, and this repository's licence does not extend to them.

Retrieval, 16 November 2026: records from the checker's API, for example https://api.babyblueviper.com/work-acceptance/record/fd2e105ced01e3047407127d391e68407e057a82f39ce068e2d28f1846238d32 for purchase 2, the others by the same pattern with their receipt hash. Keys from https://api.babyblueviper.com/.well-known/invinoveritas-checker-keys.json. Bodies from the paid responses.

## Credit

Records and the independent recomputation of the hash rule are the work of the checker's operator, babyblueviper1 (invinoveritas). The ordering procedure (commit the criteria, then buy, then post the body) is theirs. Hash members are named by the Golden Vector Provenance project. The discussion: https://github.com/x402-foundation/x402/issues/2887
