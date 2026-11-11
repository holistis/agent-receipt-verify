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
| `evidence-class-not-overclaimed` | 4 (two added 11 Nov 2026: `duplicate_payment_internal_record` honestly bounded at `ISSUER_ASSERTED`, and the same code failing when it overclaims `CHAIN_VERIFIABLE`) |
| `payment-observation-vocabulary-bounded` | 2 |
| `settlement-pending-not-presented-as-final` | 2 |
| `receipt-id-recomputes` | 3 (one added 11 Nov 2026: `client_attempt_id`/`server_observation_id` present and still passing) |
| `signature-verifies-against-resolved-key` | 3 (adds the `NOT_MEASURED` case: no observation supplied) |
| `no-equivocation-for-same-binding` | 3 (one added 11 Nov 2026: two receipts sharing one `attempt_binding` but different `client_attempt_id`/`server_observation_id` are still consistent, not a conflict) |

The 26th file, `nothing-recorded-not-measured`, carries `clause: "all"`: a vector with no observations is neither conformant nor failing, it is unmeasured.

Most vectors record what a receipt and its surrounding context already contain (a resolved key address, a signature-verified boolean) and test the checker's logic over that recording — no network, no key, no account, same approach as `vectors/attempt-identity`. The real cryptography (EIP-712 signing and verification, `did:web` resolution with the SSRF/timeout/size guards reused from `verify-delivery.mjs`) is covered separately, with a real generated key and a faked `fetch`, in `test/rejection-receipt.mjs`.

## How to run

From the root of this repository: `npm run rejection-receipt`. It needs no account, no key and no network. The canonicalization is the same RFC 8785 function (`src/canonical-request.mjs`) the rest of this repository already uses.

## Limits

- The `REDEN_TABEL` (reason code → evidence class) is our own table, not an x402 enumeration. If and when x402 defines its own error codes for this purpose, this table should be checked against that list, not the reverse. `duplicate_payment` (CHAIN_VERIFIABLE) and `duplicate_payment_internal_record` (ISSUER_ASSERTED, added 11 Nov 2026) are deliberately two different codes: the first for a duplicate an independent third party can confirm on-chain, the second for one the server recognized only from its own records.
- `client_attempt_id` and `server_observation_id` (added 11 Nov 2026) are optional, informational, top-level fields, never part of `attempt_binding`. They let a buyer tell its own separate submission attempts apart, even when two attempts carry byte-identical payment content, without changing what `attempt_binding` itself identifies. Kept out of `attempt_binding` on purpose: folding a buyer-chosen value into the same comparison that recognizes a duplicate payment would let a buyer make a reused payment look new just by picking a new value, which breaks duplicate detection. This checker does not validate their presence, format or uniqueness, the same way it does not validate `payment_observation.network`/`transaction`; it only confirms, generically, that if present they are covered by the signature like every other field.
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

## A third round (11 November 2026, after opening the x402 proposal): a real reviewer, a deep design pass, and a final call

[ruiruii commented directly on the proposal](https://github.com/x402-foundation/x402/pull/4215) with two findings. First, a citation error: §6 of the proposal attributed `attempt_binding`'s two hash names to §5.5 of #3776, which actually defines a different, three-way-separated concept (operation identity, captured-artifact digest, signed-content identifier) and never uses those names. Fixed: the proposal now names them as this proposal's own. Second, and more serious: `attempt_binding` is content-addressed, so the same payment submitted twice, once settled and once refused as `duplicate_payment`, binds to the same value both times. A buyer holding only the second receipt can prove the payload was refused, not specifically that *their second attempt* failed while a first attempt on the same payload settled, which is the exact reconciliation this whole design exists to support. We checked ruiruii's own `attempt_identity` against the same scenario, using their own published reference script: it has the identical property. This is not a defect specific to either design; it is inherent to any content-addressed identity.

We asked an independent reviewer (ChatGPT) to attack the obvious fix (folding a buyer nonce into `attempt_binding` itself) before building it. The reviewer's strongest finding: doing that would be dangerous, because it would let a buyer make a reused payment look new just by picking a new nonce value, breaking duplicate detection. Its recommendation instead: two separate, optional, top-level fields, `client_attempt_id` (buyer-chosen) and `server_observation_id` (server-chosen per actually-received request), both outside `attempt_binding` entirely. That reviewer separately flagged that `duplicate_payment`'s fixed `CHAIN_VERIFIABLE` ceiling was itself too strong for a duplicate the server only recognizes from its own internal records rather than anything checkable on-chain.

A final reasoning pass (Fable) made the call on scope for one night's work: build the two-field design (not the single-nonce version), write five real tests plus one test proving the design choice matters (see `test/rejection-receipt.mjs`, "waarom client_attempt_id/server_observation_id NOOIT in de binding-vergelijking horen"), fix the `duplicate_payment` evidence-class gap in its own small change, name the remaining ~60 test scenarios the outside reviewer listed as openly deferred rather than built, and publish all of it in the shared proposal text rather than holding any part of it back: an open-standard proposal that hides its own core mechanism reads as incomplete to a careful reviewer, and authorship stays attached to the public record regardless of who else later implements it.

**Deferred, named, not built:** timeout-and-retry semantics (does a timed-out buyer retry keep the same `client_attempt_id` or mint a new one); a reference back to an earlier `server_observation_id` inside a later receipt (and the privacy question that raises if a different party replays the lookup); server restart with an in-memory attempt table; multiple resource servers behind one `resource_origin`; the size and shape of the two new identifiers; and the remainder of roughly 55 scenarios the outside review listed. None of these are solved by this version.

## Cite

Ouadoudi, A. (holistis). Rejection receipt test vectors for x402 (own design, not yet a specification). agent-receipt-verify, 2026. https://github.com/holistis/agent-receipt-verify/tree/main/vectors/rejection-receipt

Licensed under Apache-2.0, see `LICENSE` and `NOTICE` at the root.
