# Test vectors for a Rejection Receipt (not an x402 spec, our own design, v1)

On 10 November 2026 ruiruii, the author of [x402-foundation/x402 pull request 3776](https://github.com/x402-foundation/x402/pull/3776) (section 5.5), pointed out a gap that section does not close: a duplicate payment attempt refused with HTTP 402 leaves no row anywhere, so "buyer says it paid, seller says it refused" has nothing to line up on. Section 5.5 is about whether paths agree on one `attempt_identity`, not about whether a refusal is ever recorded. This is our own answer to the second question, not a continuation of the first.

This is **not** an x402 specification. No clause below quotes official spec text, because none exists yet for this topic. Every clause is our own design decision, stated as such, with the reason it exists.

## What this is and is not

A signature proves the resource server signed a statement. It does not prove the statement is true, that the buyer sent the request, or that no payment actually moved. We asked an AI (ChatGPT, 10 November 2026) to adversarially benchmark a first draft of this design, then checked its citations against the real x402-foundation/x402 repository ourselves before building anything on top of them. Two things from that first draft did **not** survive the check:

- A GitHub issue it cited as external confirmation (`#3821`) turned out to be our own, earlier issue. Citing it as outside validation would have been us quoting ourselves in a circle, which is exactly what our own duplicate-check discipline exists to catch.
- `#2833`, the one citation that is genuinely external (opened by StelarDigital), is a real but still-open, unmerged, 126-comment proposal about delivery evidence for **successful** payments. It does not cover refusals, and it is crowded territory, not a settled fact to build on.

A second, independent review found five further gaps the first draft had not closed: a dishonest buyer can construct a one-sided "evidence" of silence that looks like a missing receipt; a `did:web` key document is just an overwritable file, so a dishonest server could later rewrite an old key's validity window; the privacy commitment protects the wrong layer (the infrastructure behind the server can still log the cleartext); the EIP-712 domain was underspecified; and a full Merkle transparency log is over-engineered for detecting a conflict that two documents already prove on their own once a buyer holds both.

A third review (playing an adversarial maintainer) named four other open threads worth checking before anyone assumes this is new ground: [`#4087`](https://github.com/x402-foundation/x402/issues/4087) (a buyer tells the seller *why it chose not to pay*, before paying — the opposite direction from this design, and it explicitly excludes post-settlement cases), and [`#3795`](https://github.com/x402-foundation/x402/pull/3795) / [`#3882`](https://github.com/x402-foundation/x402/pull/3882) / [`#3148`](https://github.com/x402-foundation/x402/issues/3148) (all about the live 402 JSON body carrying a plain-text error reason within one request/response cycle — merged, useful, and not a durable, signed, buyer-held artifact). None of the four overlap with what this package checks.

That same review found two real defects, since fixed: `toetsAfwijzingsBon` checked how honestly a claim was bounded (evidence class, vocabulary, the signing key) but never checked what was claimed — a receipt with `decision.outcome: "ACCEPTED"`, or with no `attempt_binding` at all, passed anyway, through the exact unguarded side door this design exists to close. Both are now the ninth clause, `decision-outcome-and-binding-present`. The published `npx` command this package advertises also pointed at a file that is not included when the package is published (`test/` is not in `package.json`'s `files` list) — confirmed with `npm pack --dry-run`, not assumed — and now points at `src/rejection-receipt.mjs` instead, the same pattern `attempt-identity.mjs` already uses.

**Phase 1, deliberately narrow.** This package signs nothing. Every existing file in this repository (`attempt-identity.mjs`, `x402-offer-receipt.mjs`, `verify-delivery.mjs`, `inam-countersigned.mjs`) only verifies; none of them holds a private key. Building a running issuer that holds a long-lived signing key, publishes rotation, and signs on real refusals is a different kind of project (key custody, uptime, a rotation process) layered onto a feature that does not exist yet, and a stored key without a mature rotation process is worse than no key. This package ships the schema, the checker, and the vectors. A party that wants to use this signs with its own key management, the same role `x402-offer-receipt.mjs` and `attempt-identity.mjs` already play for other x402 artifacts.

Also not here: the buyer does not sign a separate "Attempt Intent" before sending. Without that, a request the buyer never sent is, in this version, indistinguishable from a real one — a limitation stated here, not a hidden guarantee. Witness mode and a Merkle transparency log (phase 3) are not here either; `INDEPENDENTLY_WITNESSED` exists as an enum value, but no `reason_code` below points to it, because nobody makes that claim true yet.

## What is here

Nine clauses, each with at least one acceptance and one rejection:

| Clause | Vectors |
| --- | --- |
| `decision-outcome-and-binding-present` | 3 (two rejections: a non-`REJECTED` outcome, and a missing `attempt_binding`) |
| `dedicated-signing-key-not-payto` | 2 |
| `reason-code-bounded-fail-closed` | 3 (the third shows the fail-closed default itself passing: an unknown reason honestly bounded at `ISSUER_ASSERTED`) |
| `evidence-class-not-overclaimed` | 2 |
| `payment-observation-vocabulary-bounded` | 2 |
| `settlement-pending-not-presented-as-final` | 2 |
| `receipt-id-recomputes` | 2 |
| `signature-verifies-against-resolved-key` | 3 (adds the `NOT_MEASURED` case: no observation supplied) |
| `no-equivocation-for-same-binding` | 2 |

The twenty-second file, `nothing-recorded-not-measured`, carries `clause: "all"`: a vector with no observations is neither conformant nor failing, it is unmeasured.

Most vectors record what a receipt and its surrounding context already contain (a resolved key address, a signature-verified boolean) and test the checker's logic over that recording — no network, no key, no account, same approach as `vectors/attempt-identity`. The real cryptography (EIP-712 signing and verification, `did:web` resolution with the SSRF/timeout/size guards reused from `verify-delivery.mjs`) is covered separately, with a real generated key and a faked `fetch`, in `test/rejection-receipt.mjs`.

## How to run

From the root of this repository: `npm run rejection-receipt`. It needs no account, no key and no network. The canonicalization is the same RFC 8785 function (`src/canonical-request.mjs`) the rest of this repository already uses.

## Limits

- The `REDEN_TABEL` (reason code → evidence class) is our own table, not an x402 enumeration. If and when x402 defines its own error codes for this purpose, this table should be checked against that list, not the reverse.
- The `did:web` resolution supports only the bare-host form (`did:web:<host>#<fragment>`), and only a `blockchainAccountId` in CAIP-10 form as the key material. It does not implement path-segment `did:web` identifiers or other verification method types.
- Detecting a contradictory pair of receipts (`toetsTegenstrijdigheid`) only works once a buyer holds both documents. Nothing here guarantees a buyer ever receives the second one; that is the harder problem phase 3's witness mode would address, not yet solved here.
- This does not solve the "server sends no receipt at all" case. Silence is not proof of a refusal, and this package does not manufacture one from the absence of a response.
- Key rotation and revocation are read as a plain, overwritable `did.json`. The checker returns the raw resolved document alongside the address specifically so a caller can cache it as its own evidence the moment a receipt arrives, rather than trusting a later re-resolution of the same URL.

## A second review round (10 November 2026, before opening the x402 proposal)

Before proposing this to x402-foundation/x402, three more independent passes checked the design and this README's own claims: one re-verified every factual claim against the live code and a fresh GitHub search, one played an adversarial maintainer, one read both documents as a confused or careless reader would. Between them they found:

- `#3148` was mischaracterized as merged in an earlier draft of the proposal text; it is a still-open issue. Fixed.
- The proposal's worked example showed a receipt as fully verified when, in fact, the `dedicated-signing-key-not-payto` check was never evaluated for it, because this checker only runs that check when a caller supplies both the resolved signing address and the seller's `payTo` address, and silently skips it otherwise, unlike the signature-verification check right next to it, which does return `NOT_MEASURED` in the equivalent situation. Not fixed yet (see Limits below); the proposal text now says so plainly instead of calling it an unqualified "checked rule."
- A real design gap, not a documentation issue: nothing here checks that a receipt's `issuer.key_id` host matches its `issuer.resource_origin` host. A receipt could sign truthfully for one host while falsely claiming to speak for a different `resource_origin`, and nothing in this design catches that. Disclosed in the x402 proposal's security considerations; not fixed in this version.
- ruiruii independently sketched a server-internal, unsigned row for the same underlying gap (`gates-spec v0.1`) on the same day this proposal was opened, on the same x402-foundation/x402#3776 thread. That citation describes their own sketch as they scoped it, not an endorsement of this package.

None of these changed the nine clauses or the twenty-two vectors above; they changed what this README and the x402 proposal honestly claim about what the checker does and does not yet enforce.

## Cite

Ouadoudi, A. (holistis). Rejection receipt test vectors for x402 (own design, not yet a specification). agent-receipt-verify, 2026. https://github.com/holistis/agent-receipt-verify/tree/main/vectors/rejection-receipt

Licensed under Apache-2.0, see `LICENSE` and `NOTICE` at the root.
