# Test vectors for x402 specification v2, section 5.5

Sixty-one vectors over the twelve clauses of section 5.5, the Settlement and Refusal Identity Invariant, plus one vector that states a property of the checker. They follow the text of the section as proposed in [x402-foundation/x402 pull request 3776](https://github.com/x402-foundation/x402/pull/3776), checked against commit `8494922` on 26 October 2026. The first set was written by Abdellah Ouadoudi ([github.com/holistis](https://github.com/holistis)) on 18 October 2026, before any test for this section existed. It was rebuilt on 26 October when the section was rewritten, and corrected the same day after an independent audit (see the end of this file).

## What is here

Each clause carries at least one acceptance and at least one rejection:

| Clause | Vectors |
| --- | --- |
| `derive-once-at-ingress` | 2 |
| `ingress-snapshot-complete` | 2 |
| `all-paths-same-artifact` | 2 |
| `changed-request-different-artifact` | 5 |
| `own-identity-from-decoded-fields` | 2 |
| `normalization-applied` | 2 |
| `canonical-members` | 25 |
| `absent-member-omitted` | 2 |
| `countersignature-recompute-or-refuse` | 8 |
| `three-identifiers-not-collapsed` | 6 |
| `outcome-not-folded-into-identity` | 2 |
| `name-independent-but-bound` | 3 |

The sixty-second file, `nothing-recorded-not-measured`, carries `clause: "all"`: a vector with no observations is neither conformant nor failing, it is unmeasured.

Two kinds of vector sit side by side. Most record what an implementation did (identities, paths, a counterparty's answer) and say what a checker must conclude. The `known-answer-` vectors in `canonical-members` are different: they pin the canonical query string and the SHA-256 of a request body, for a raw request, and any implementation in any language can reproduce them without our checker. Their expected values were computed twice, by the JavaScript checker and by a Python implementation that uses only its standard library. The two share no code and agree on all seven inputs, but we wrote both. A third implementation, written and run by ruiruii, matches all seven as well (x402 pull request 3776, comment 6419277292).

Every vector states its provenance and a `limits` line saying what it does not show.

## How to run

From the root of this repository: `npm run attempt-identity`. It prints the recorded verdict of each vector and needs no account, no key and no network. The canonicalization the checker applies (RFC 3986 query, content-encoding and charset decoding, RFC 8785 with SHA-256) is in `src/canonical-request.mjs`.

## Limits

- The text of the section settles the plus sign (it stays a plus), an empty query against no query (the same case, the member is omitted) and JSON with duplicate keys (hashed as its decoded bytes). It does not settle two more things, so the reference checker chooses: an empty segment in a query (`a=1&&b=2`) is dropped, and a `%` that is not followed by two hex digits is kept as a literal percent sign. If the section decides otherwise, the vectors move with it.
- The checker does not run a format's own signing recipe (for example an EIP-712 hash). For a reference to signed content it checks that two serializations of the same content give the same reference and that the reference is not the digest of the envelope.
- The identity values in the recording vectors are labels produced by one function, so a vector of that kind shows whether a checker reads a recording correctly, not whether an implementation hashes the right members in the right order. The `known-answer-` vectors are the part that tests an implementation against the text.
- The vectors do not certify a facilitator, and they do not check a typed-data signature.

## Audit, 26 October 2026

A review pass that we ran ourselves, with AI reviewers that did not write the vectors, read them against the section and the checker. It is our own check and not an outside audit. It found defects: a collapsed identity could still pass overall, missing data counted as compliance, the three-identifiers check demanded a canonicalized form that the text says a reference must not be required to take, address lowercasing applied to every address, ISO-8859-1 was decoded as windows-1252, duplicate JSON keys escaped detection, and an implementation that replaced every identity by another hash still passed all vectors. Each of these now has a regression test in `test/attempt-identity.mjs`, and the last one is why the known-answer vectors exist.

## Cite

Ouadoudi, A. (holistis). Attempt-identity test vectors for x402 section 5.5. agent-receipt-verify, 2026. https://github.com/holistis/agent-receipt-verify/tree/main/vectors/attempt-identity

Licensed under Apache-2.0, see `LICENSE` and `NOTICE` at the root.
