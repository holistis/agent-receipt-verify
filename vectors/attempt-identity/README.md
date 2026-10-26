# Conformance vectors for x402 specification v2, section 5.5

Forty vectors over the twelve normative clauses of section 5.5, the Settlement and Refusal Identity Invariant, plus one vector that states a property of the checker. They follow the text of the section as proposed in [x402-foundation/x402 pull request 3776](https://github.com/x402-foundation/x402/pull/3776), checked against commit `c207612` on 26 October 2026. The first set was written by Abdellah Ouadoudi ([github.com/holistis](https://github.com/holistis)) on 18 October 2026, before any normative test for this section existed, and was rebuilt on 26 October when the section was rewritten.

## What is here

Each clause carries at least one acceptance and at least one rejection:

| Clause | Vectors |
| --- | --- |
| `derive-once-at-ingress` | 3 |
| `ingress-snapshot-complete` | 2 |
| `all-paths-same-artifact` | 2 |
| `changed-request-different-artifact` | 3 |
| `own-identity-from-decoded-fields` | 2 |
| `normalization-applied` | 2 |
| `canonical-members` | 9 |
| `absent-member-omitted` | 2 |
| `countersignature-recompute-or-refuse` | 6 |
| `three-identifiers-not-collapsed` | 5 |
| `outcome-not-folded-into-identity` | 2 |
| `name-independent-but-bound` | 2 |

The forty-first file, `nothing-recorded-not-measured`, carries `clause: "all"`. It is a property of the checker and not of any clause: a vector with no observations is neither conformant nor failing, it is unmeasured.

Every vector states its own provenance, including the fact that the section it tests is on a pull request branch and not on `main`, and a `limits` line saying what it does not show.

## How to run

From the root of this repository: `npm run attempt-identity`. It prints the recorded verdict of each vector and needs no account, no key and no network. The canonicalization the checker applies (query, body decoding, RFC 8785) is in `src/canonical-request.mjs`.

## Limits

- The text of the section does not settle three things, and the reference checker has to choose: a plus sign in a query (RFC 3986 reads it as a literal plus, form decoding as a space; the checker follows RFC 3986), an empty query against no query (the checker treats them as equal), and JSON with duplicate keys (the checker does not canonicalize it as JSON, so a parser that keeps the last key cannot silently collapse two bodies into one). If the section decides any of these differently, the vectors move with it.
- The checker computes the canonical members and judges recorded identities. It does not check a typed-data signature, and it does not run a facilitator.
- The vectors test how a checker judges recorded observations. They do not certify a facilitator.

## Cite

Ouadoudi, A. (holistis). Attempt-identity conformance vectors for x402 section 5.5. agent-receipt-verify, 2026. https://github.com/holistis/agent-receipt-verify/tree/main/vectors/attempt-identity

Licensed under Apache-2.0, see `LICENSE` and `NOTICE` at the root.
