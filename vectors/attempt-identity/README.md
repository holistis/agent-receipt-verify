# Test vectors for x402 specification v2, section 5.5

Since 0.2.22 these vectors follow the query bullet of section 5.5 at commit 2819ed7 of pull request 3776: the canonical query keeps the pairs in the order they arrived instead of sorting them. A reviewer (NSPG13) pointed out that sorting makes `?q=a&q=b` and `?q=b&q=a` one identity, and every library we measured (24 of 24 rows, see research/repeated-query-matrix) answers differently for them. The author of the section took the replacement text, and her own implementation agrees with all 22 known-answer files (pull request 3958, comment 6424707421).

Seventy-one vectors over the twelve clauses of section 5.5, the Settlement and Refusal Identity Invariant, plus one vector that states a property of the checker. They follow the text of the section as proposed in [x402-foundation/x402 pull request 3776](https://github.com/x402-foundation/x402/pull/3776), checked on 26 October 2026 against the text at the head of that pull request, commit `2819ed7`. The 22 known-answer files were recomputed against that text by two people outside this project, each with their own implementation: [ruiruii](https://github.com/x402-foundation/x402/pull/3958#issuecomment-6424707421) and [NSPG13](https://github.com/x402-foundation/x402/pull/3958#issuecomment-6427311341). We know of no outside recompute of the other 50 vectors. The first set was written by Abdellah Ouadoudi ([github.com/holistis](https://github.com/holistis)) on 18 October 2026, before any test for this section existed. It was rebuilt on 26 October when the section was rewritten, and corrected the same day after a review pass of our own (see the end of this file).

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
| `canonical-members` | 35 |
| `absent-member-omitted` | 2 |
| `countersignature-recompute-or-refuse` | 8 |
| `three-identifiers-not-collapsed` | 6 |
| `outcome-not-folded-into-identity` | 2 |
| `name-independent-but-bound` | 3 |

The seventy-second file, `nothing-recorded-not-measured`, carries `clause: "all"`: a vector with no observations is neither conformant nor failing, it is unmeasured.

Two kinds of vector sit side by side. Most record what an implementation did (identities, paths, a counterparty's answer) and say what a checker must conclude. The `known-answer-` vectors in `canonical-members` are different: they pin the canonical query string and the SHA-256 of a request body, for a raw request, and any implementation in any language can reproduce them without our checker. Their expected values were computed twice, by the JavaScript checker and by a Python implementation that uses only its standard library. The two share no code and agree on all eleven inputs, but we wrote both. A third implementation, written by ruiruii, agrees on all eleven right values and rejects all eleven wrong ones (x402 pull request 3958, comment 6424707421). NSPG13 also checked the five that did not change (comment 6420653774).

Every vector states its provenance and a `limits` line saying what it does not show.

## How to run

From the root of this repository: `npm run attempt-identity`. It prints the recorded verdict of each vector and needs no account, no key and no network. The canonicalization the checker applies (RFC 3986 query, content-encoding and charset decoding, RFC 8785 with SHA-256) is in `src/canonical-request.mjs`.

## Limits

- The text of the section settles the plus sign (it stays a plus), an empty query against no query (the same case, the member is omitted) and JSON with duplicate keys (hashed as its decoded bytes). It does not settle two more things, so the reference checker chooses: an empty segment in a query (`a=1&&b=2`) is dropped, and a `%` that is not followed by two hex digits is kept as a literal percent sign. If the section decides otherwise, the vectors move with it.
- The arrival-order rule also changes three details that the sorted text did not touch: a name without an equals sign stays bare (`q` is not `q=`), a semicolon is part of a value and not a separator, and a byte that is not valid UTF-8 after percent-decoding is kept as that octet. A route that knows its handler is order-independent would need a declared profile; these vectors cover the default only.
- The checker does not run a format's own signing recipe (for example an EIP-712 hash). For a reference to signed content it checks that two serializations of the same content give the same reference and that the reference is not the digest of the envelope.
- The identity values in the recording vectors are labels produced by one function, so a vector of that kind shows whether a checker reads a recording correctly, not whether an implementation hashes the right members in the right order. The `known-answer-` vectors are the part that tests an implementation against the text.
- The checker writes the objects it hashes with its own key-sorted compact JSON function, and writes bodies with a separate canonicalizer. We compared both with the canonicalize package (version 5.1.0), a separate RFC 8785 implementation: on the 484 objects stored in these 72 vectors, on the 113 objects hashed and the 94 canonicalizer calls made while the checker ran the vectors, and on 68 edge cases that include 25 numbers, exponent forms and negative zero among them. The text was identical every time, and test/rfc8785-gelijk.mjs repeats the comparison on every run of the suite. There is one known difference: the first function lists property names such as "9" and "10" in numeric order, where RFC 8785 sorts them as text, so an object with such names would hash differently from an implementation that follows the RFC. No object in these vectors has such names, and the test fails if one appears.
- The vectors do not certify a facilitator, and they do not check a typed-data signature.

## Stability

Cite a tag, not `main`. The 22 `known-answer-` files, eleven right values and eleven wrong ones, are the part of this set that people outside this project have checked. On 27 October 2026 they were byte for byte the same in the tag v0.2.23, on main and in x402 pull request 3958. They do not change: if one turns out to be wrong, it stays as it is, the correction goes into a new file, and this section says which file replaces which and why. `npm test` fails if one of the 22 changes (`test/attempt-identity-bevroren.mjs`). The other 50 vectors were written and checked by us, and they can change between releases. A fixed copy of the whole set: https://github.com/holistis/agent-receipt-verify/tree/v0.2.23/vectors/attempt-identity

## Audit, 26 October 2026

A review pass that we ran ourselves, with AI reviewers that did not write the vectors, read them against the section and the checker. It is our own check and not an outside audit. It found defects: a collapsed identity could still pass overall, missing data counted as compliance, the three-identifiers check demanded a canonicalized form that the text says a reference must not be required to take, address lowercasing applied to every address, ISO-8859-1 was decoded as windows-1252, duplicate JSON keys escaped detection, and an implementation that replaced every identity by another hash still passed all vectors. Each of these now has a regression test in `test/attempt-identity.mjs`, and the last one is why the known-answer vectors exist.

## Cite

Ouadoudi, A. (holistis). Attempt-identity test vectors for x402 section 5.5. agent-receipt-verify, 2026. https://github.com/holistis/agent-receipt-verify/tree/main/vectors/attempt-identity

Licensed under Apache-2.0, see `LICENSE` and `NOTICE` at the root.
