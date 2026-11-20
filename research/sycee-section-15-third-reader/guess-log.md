# Guess log, written BEFORE the reader was written and BEFORE any recorded answer was opened

What I had read when this was written: SPEC.md (639 lines) at 632c2f56, specs/extensions/refusal-row.md (582 lines), conformance/refusal/README.md.
What I had opened of the vectors: the key names, and the `input` object of every file. I had NOT opened `observed`, `expected` or `note` values.
What I did not open: verify_known_answers.py, verify-known-answers.mjs, judge.mjs, packages/core, any test.

Reading rule for the reader: the reader is built from the prose of the extension and SPEC.md only. The README is used for the format of the files and for the names of the rejection codes (the prose names none). Where the prose is silent I take the narrowest reading and write it down here. I do not use the README's one-line descriptions of individual vectors to design a rule.

## Things the prose does not say (each is a guess in the reader)

G1  Rejection codes. The prose names no rejection codes. The only text is the error string for the overclaim in 15.5. The codes in the reader come from the README list (leg_contradicts_reason, leg_not_observed, unknown_leg, unknown_leg_status, not_reproducible, finality_pending_is_not_final, finality_accepted_not_submitted). A reader built from the prose alone could not produce them.

G2  Shape of `legs`. 15.4 writes `legs.<leg>.status`, section 4 writes `{ authorization, transfer }`. The vectors use a bare string per leg. The reader accepts a bare string and an object with `status`.

G3  `final` when the input carries none. The prose says only "MUST be false when pending". The reader defaults to `settlement !== pending`, so `unknown` gives true. Reason: the table of repeat-presentation reasons states `final = false` for pending and says nothing for `unknown`.

G4  `evidence_class` of an accepted row. Section 4 says required "when refused". The reader emits null for an accepted row.

G5  Order of evidence classes. Not stated. The reader uses the order in which the enum is listed: issuer_asserted, client_verifiable, chain_verifiable, independently_witnessed.

G6  Default evidence_class. 15.7 says the reproducible ceiling, not the base ceiling. The reader uses: client_verifiable for the four client reasons; chain_verifiable for authorization_expired, authorization_not_yet_valid, duplicate_payment, nonce_already_used; issuer_asserted for transfer_leg_failed (15.5), insufficient_funds (section 5 says the honest claim is issuer_asserted), the four issuer reasons and any unknown reason (fail closed). SPEC.md 5.5.2 lists insufficient_funds at chain_verifiable and has no transfer_leg_failed; the extension wins because 15.7 says the default is the reproducible ceiling.

G7  15.5 general rule read literally also bears on `duplicate_payment` ("the proof was already settled" may rest on a balance movement). The prose names only transfer_leg_failed and insufficient_funds. The reader keeps duplicate_payment at chain_verifiable. No vector is expected to cover it.

G8  Which statuses a reason permits (the code has REQUIRED_LEG_STATUS, the prose has no table). Reader:
    - transfer_leg_failed: both legs must be recorded when `legs` is present (else leg_not_observed); authorization must be `executed` (the table says "the authorization leg executed"); transfer must be `failed` (15.3 separates "reverted" from "learned nothing").
    - nonce_already_used: when `legs` is present, authorization must be recorded and `executed`.
    - wrong_amount and authorization_expired are the two reasons the prose calls claim-free. For these an `executed` leg is a contradiction; `failed`, `not_reached` and `unknown` are allowed.
    - every other reason: no leg rule at all. In particular risk_policy_rejected with an executed authorization is ACCEPTED by this reader, because the prose says nothing about what that reason means for the legs.

G9  Section 13 maps the registered branch `purchase_not_settled` to `accepted (not_submitted)` as a normal output. So the reader ACCEPTS decision accepted with settlement not_submitted. The README lists a rejection code finality_accepted_not_submitted, which suggests the opposite.

G10 Order of checks when a row breaks more than one rule: unknown leg name, unknown leg status, finality, leg rules, overclaim. Not specified.

G11 Invalid `decision` or invalid `settlement` value: the reader rejects with invented codes (bad_decision, bad_settlement). The prose requires a rejection (section 6, items 1 and 4) but names no code.

G12 `evidence_class` supplied in the input at or below the reproducible ceiling: the reader returns it as given. Above it: not_reproducible. An evidence_class on an accepted row: not tested, the reader ignores it.

## Predictions, made before the run (so they cannot be adjusted afterwards)

P1  Disagreement on the vector that rejects accepted + not_submitted (G9).
P2  Disagreement on the vector that rejects a risk refusal after submission (G8).
P3  Disagreement on the accepted vector where authorization is unknown and the reason is transfer_leg_failed (G8), if such a vector exists.
P4  Possible disagreement on `final` for the rows with settlement unknown (G3).
P5  Everything else agrees.
