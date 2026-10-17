# x402 receipt conformance, edition 1

Dated 2026-10-17. This file defines a unit of measurement, not a score. If you
publish a different number for the same population, the useful conversation is
about which level you laid differently, and that is what this file exists to make
possible.

## Why a definition comes before a number

Measurements of the x402 population are already in circulation: counts of live
resources, and the observation that none of a sampled set declared the
offer-receipt extension. None of them says what was counted. Without a stated
unit, percentages are not comparable, and two honest people measuring the same
thing will disagree for reasons neither can see.

Two specific ways that goes wrong, both of which we walked into before writing
this down:

- **Counting endpoints instead of operators.** One operator with several hundred
  paths then outweighs several hundred operators with one path each. Our own first
  pass produced a headline figure that was almost entirely one party's paths. The
  unit below is the operator, by host.
- **Treating "works" as one thing.** Returning 402 at all, declaring the receipt
  extension, signing the offer, and actually emitting a linkable receipt are four
  different claims with four different costs. A single pass/fail hides which one
  an implementer still owes.

## The unit

**One operator**, identified by the host of its resource URL. Where an operator
exposes many paths, one is measured and the operator counts once.

## The ladder

Each level requires every level below it. A level is recorded as reached, not
reached, or **not measured**, and the third is not a failure: levels 3 to 5 cannot
be observed without paying, so an unpaid measurement reports them as unmeasured
rather than as absent.

| Level | Claim | Requirement | Observable without paying |
|---|---|---|---|
| 0 | asks for payment the way x402 says | HTTP 402 carrying `accepts[]` with `scheme`, `network`, `payTo` and an amount, in the body or in the `Payment-Required` header | yes |
| 1 | declares the offer-receipt extension | the 402 carries an `offer-receipt` entry in `extensions` | yes |
| 2 | signs its offer, and the signature verifies | `extensions["offer-receipt"].info.offers[0]` is a signed artifact whose signature verifies: an `eip712` artifact recovering to an address, or a `jws` with an EdDSA signature over the offer payload whose key resolves from its `kid` | yes |
| 3 | emits a receipt that verifies | after payment, the settlement response carries a receipt whose signature recovers to the same signer | no |
| 4 | receipt is version 2, and the salt arrives where §5.6.3 says | `payload.version` is 2 with both commitment fields, and the salt is at `extensions["offer-receipt"].info.authorizationSalt` | no |
| 5 | the commitment opens against the chain to exactly one settlement | §5.6.4 run against live chain state resolves to exactly one `AuthorizationUsed` nonce | no |

Levels 4 and 5 cite sections 5.6 and later of the offer-receipt extension. Those do
not exist on `main`: they live only in pull request 3827, which is open, pinned here
to commit `0e492d6`. Both levels are marked as citing a proposal in
[profiles/x402-deployed-ladder-v1.json](profiles/x402-deployed-ladder-v1.json), and
the tool repeats that in its output.

Level 0 deliberately fails a 402 that carries no requirements. A payment demand
that does not say what to pay cannot be acted on, and treating it as conforming
would make the level meaningless.

Level 2 requires the signature to verify, not merely to be present. A declaration
with an unverifiable signature is a claim about a claim.

Level 2 accepts either signature form. A signature that cannot be checked because
this checker does not implement its algorithm is recorded as not measured, never as
not reached: not supported and not valid are different answers, and only one of them
is about the operator.

## How to reproduce it

```sh
node src/x402-conformance-check.mjs <url> [url ...]
```

Levels 0 to 2 are measured. Levels 3 to 5 are reported as not measured, with the
reason. Every verdict comes with the evidence it rests on, so a different result
is traceable to a different observation rather than to a different opinion.

Conduct, because this touches other people's endpoints: one request per endpoint,
the same request an ordinary buyer makes, never a payment, never a repeat to force
an outcome, a user agent that says who is calling, and a pause between endpoints.

## What this does not measure, on purpose

- **Whether an operator is honest.** These are checks on the form of a response.
- **Whether the paid resource delivered anything.** That is the other half of a
  delivery record and is out of scope here.
- **Whether a receipt is counted by any consumer.** §5.6.5 says a consumer
  counting settlements may count only opened commitments; whether a given consumer
  does so is its own business and not observable from the seller side.
- **Levels 3 to 5 without a payment.** An endpoint can be at level 2 here and at
  level 5 in reality. The measurement says what was observed, never what was
  assumed.

## Changing the ladder changes the edition

The levels live as data in `src/x402-conformance-treden.mjs`. If a level is added,
removed or reworded, that is a new edition with a new date, and the old one stays
readable. A measurement whose unit silently moved is worse than no measurement,
because it looks comparable and is not.

### 2026-10-17, level 2 widened

Level 2 required an `eip712` artifact. Measuring live endpoints found an operator
that does sign its offer, in `jws` with an EdDSA signature and a `did:web` key, and
this ladder scored that as a failure. That was a defect in the unit, not in the
operator: a ladder that does not know a valid form measures that party wrongly and
would have made a published number false. Level 2 now asks for a signed offer whose
signature verifies, in either form, and names the forms it cannot check.

The results that led to this are in `editions/2026-10-17/`, including the live
measurement that produced the wrong score before the fix.
