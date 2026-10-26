# Conformance vectors for x402 specification v2, section 5.5

Eighteen vectors over the eight normative clauses of section 5.5, the Settlement and Refusal Identity Invariant, plus one vector that states a property of the checker. The section is proposed in [x402-foundation/x402 pull request 3776](https://github.com/x402-foundation/x402/pull/3776). The vectors were written by Abdellah Ouadoudi ([github.com/holistis](https://github.com/holistis)) on 18 October 2026, before any normative test for this section existed.

## What is here

Each clause carries one acceptance and at least one rejection:

| Clause | Vectors |
| --- | --- |
| `all-paths-same-artifact` | 2 |
| `changed-request-different-artifact` | 3 |
| `name-independent-but-bound` | 2 |
| `countersignature-recompute-or-refuse` | 3 |
| `derive-once-at-ingress` | 2 |
| `own-identity-from-decoded-fields` | 2 |
| `outcome-not-folded-into-identity` | 2 |
| `reference-over-transmitted-bytes` | 2 |

The nineteenth file, `nothing-recorded-not-measured`, carries `clause: "all"`. It is a property of the checker and not of any clause: a vector with no observations is neither conformant nor failing, it is unmeasured.

Every vector states its own provenance, including the fact that the section it tests is on a pull request branch and not on `main`.

## How to run

From the root of this repository: `npm run attempt-identity`. It prints the recorded verdict of each vector and needs no account, no key and no network.

## Limits

- The reference checker computes the identity digest as SHA-256 over key-sorted compact JSON. That is enough to test the clauses, but it is not a full canonical form. If the specification names one (for example RFC 8785), the vectors move with it.
- The vectors test how a checker judges recorded observations. They do not certify a facilitator.

## Cite

Ouadoudi, A. (holistis). Attempt-identity conformance vectors for x402 section 5.5. agent-receipt-verify, 2026. https://github.com/holistis/agent-receipt-verify/tree/main/vectors/attempt-identity

Licensed under Apache-2.0, see `LICENSE` and `NOTICE` at the root.
