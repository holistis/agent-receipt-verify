Cite as: github.com/holistis/agent-receipt-verify, interop/refusal-row, 2026-11-23.

# Where the refusal row text does not decide

The code in `refusal-row.mjs` was written from the text of one specification file (refusal-row-d9552b8.md, 739 lines, sha256 f0b9d8e54e04b915e6d0faaa73401bd1acd2cfbc10595840bff76eb5edc64acf) and run against `spec-examples.test.mjs`, which was written from the same text by the same author. Result of that run: 214 tests, 203 pass, 0 fail, 11 skipped (see A20). That says the code agrees with its author's reading, nothing more.

Line numbers refer to that file. Quotes leave out dashes. Everything the text says by pointing to another document counts as not decided.

Rule used when the text is silent: reject only what a sentence or an enumerated set rejects, except where carrying a field would leave a reader unable to tell an ignored field from an unwritten one (the argument at lines 588 to 591), and then reject. Where an entry says "other reading", the effect is what changes if that reading is the right one.

## Entries

A1. Names. Interface field `signing_public_key`, spec field `signer.public_key` (line 101). Line 509 writes `legs.<leg>.status` for a nested object, so the dotted name is read as nesting: `fields.signer.public_key`. Other reading: a flat key named `signer.public_key`.

A2. Partial output. Lines 98 to 100 and 102 mark `resource_id`, `protocol`, `observed_at`, `signer.role` as required, line 96 lists `proof_hash`; the interface supplies none of them, so none is emitted or invented. Line 103 "`distinct`, or `not_measured` when the payee is unknown": no payee is supplied, so `key_check` is always `not_measured` and `distinct` is unreachable. Other reading: defaults for the missing fields.

A3. Key format. Line 101 "`ed25519:<base64url>`". Not stated: padding, length (a 32 byte key is 43 characters unpadded, the text never says so), alphabet. Taken: the prefix, then one or more of A-Z a-z 0-9 _ -, no padding. Other reading: exact length, or padding allowed. Invented code: `invalid_signing_public_key`.

A4. Identity format. Line 93 "`sha256:<64 hex>`". Case not stated. Taken: lowercase only. The derivation cannot be checked because payload, requirements and ordinal are not inputs, so a well formed identity that was derived wrongly is accepted. Invented code: `invalid_attempt_identity`.

A5. `final`. Line 95 "MUST be `false` when `settlement` is `pending`", required "Yes", but optional in the interface. Nothing says what it is when settlement is not pending. Taken: omitted means `false` (the weakest claim); a given `true` is kept unless settlement is pending. Other reading: omitted is an error, or derived (for example `true` when `settled`). Invented codes: `final_invalid` (not a boolean), `pending_must_not_be_final`.

A6. Basic enumerations. Line 196 "`decision` is one of the two values", line 200 "`settlement` is one of the four values": no code is named. Invented: `unknown_decision`, `unknown_settlement`, and `malformed_input` for an input that is not a plain object.

A7. Reason and evidence codes. Line 153 "§6.2 rejects the row" and lines 197 to 198 name no code; a missing reason ("When refused", line 90), an evidence class outside the four (line 92) and a class above its ceiling (line 199) name none either. Lines 657 to 660 give only a message, "chain_verifiable is not reproducible". Invented: `unknown_reason`, `missing_reason`, `unknown_evidence_class`, `evidence_exceeds_ceiling` (above the base ceiling), `evidence_not_reproducible` (above the reproducible ceiling but not above the base one, which is the case at lines 657 to 660). Other reading: one code for all evidence faults.

A8. `reason_detail`. Lines 91 and 269 "The fixed sentence for that reason"; the sentences are never listed. Taken: the Meaning column of the table at lines 132 to 151 without its trailing cross references, and for `transfer_leg_failed` the sentence at line 494 (line 143 words it differently: "in one attempt (§15)"). Other reading: different sentences. Effect: the string differs; the tests only check that it is a non empty string.

A9. Ceiling of `transfer_leg_failed`. Line 143 gives `issuer_asserted` ("Closes here, not at `chain_verifiable`"); line 494 calls `chain_verifiable` the "Base ceiling" and lines 496 to 498 say section 15.5 "takes most of it away". The effective ceiling is `issuer_asserted` on both readings. Taken: base `chain_verifiable`, reproducible `issuer_asserted`. Effect: only which code the example at lines 657 to 660 gets.

A10. Which reasons fall under the reproducibility rule. Lines 664 to 666 state a rule over "every leg whose execution it depends on" and markers "a third party can attribute"; the input carries no scheme. Only `transfer_leg_failed` is named as losing its ceiling. Not decided: whether `duplicate_payment` and `replay_already_settled` (a prior settlement) also depend on an unattributed transfer leg under a split-leg scheme. Taken: only `transfer_leg_failed`. Other reading: more reasons default lower, and claiming the base class for them is rejected.

A11. Order of the classes. Never stated. Taken: the order of the list at line 92, lowest `issuer_asserted`, highest `independently_witnessed`. Other reading: another order changes which claims exceed a ceiling.

A12. Accepted rows. Lines 90 to 92 say reason and evidence class are required "When refused", which does not forbid them on an accepted row. Line 637 says "an accepted row records no legs at all (L2)", but L2 (lines 521 to 525) says no such thing. Taken: an accepted row that carries `reason`, `evidence_class` or `legs` is rejected, invented code `refused_field_on_accepted_row`. Other reading: such fields are ignored or kept.

A13. Settlement on a refused row. Without `legs`, any of the four settlement values is accepted for every reason except the three repeat reasons; line 183 to 185 says `duplicate_payment` is not constrained. Lines 564 to 566 call a refusal whose transfer completed "a payment recorded wrongly", which hints that `settled` beside an ordinary refusal is wrong, but no sentence forbids it when no leg is recorded (L1, lines 518 to 519). An accepted row accepts any settlement (line 365). Other reading: reject `settled` on a refusal unless the reason is a repeat reason or `duplicate_payment`.

A14. L2 against the table. Lines 522 to 524 say a reason with no leg claim, "`wrong_amount`, `authorization_expired`", must not carry leg observations that contradict the absence of a claim, but lines 535 and 539 give both reasons a required authorization cell. Taken: the table. Other reading: those reasons carry no legs and any row with legs is rejected.

A15. Reach of the required mark. Lines 554 to 556 "the row must carry that leg" against L1 "A refused row MAY omit `legs`". Taken: a required leg is demanded only when `legs` is present (line 521 "When `legs` is present"). Other reading: required legs are demanded always, which would reject every row that omits `legs`.

A16. Prose against table. Lines 638 to 641 say `authorization_expired` and `malformed_payload` admit authorization `not_reached` or `unknown`; the table gives `malformed_payload` three values (line 538) and `authorization_expired` `failed`, `unknown` (line 539). Line 561 "three cells in `authorization` change" is not itemised. Taken: the table. Other reading: `authorization_expired` admits `not_reached`.

A17. Order of checks. The text names no order for a row with two faults. Taken: input shape, signing key, identity, decision, settlement, final, accepted row fields, reason, evidence class, legs (leg names, leg shapes and statuses, a required leg missing, status against reason, L4, L6), repeat reason. Three decisions inside it. (a) Lines 529 to 530 say `unknown_leg_status` applies "whatever the reason", while lines 567 to 568 and 601 to 603 say a row with an unknown reason is rejected "before a leg is read"; taken: the reason first. (b) A missing required leg is reported before a status that contradicts the reason, following the sentence order of L2. (c) Legs before the repeat table, following the numbering of section 6 (items 4 then 5). Effect: only the code of rows with two faults.

A18. Shape of `legs`. Line 97 "`{ authorization, transfer }`" and line 509 `legs.<leg>.status` are read as `legs: { authorization: { status }, transfer: { status } }`. Taken: `legs` that is not a plain object, a leg that is not a plain object, a key present but undefined, or any key inside a leg other than `status` gives `malformed_legs` (invented); a missing or unrecognised status gives `unknown_leg_status`; `legs: {}` counts as present. Other reading: a bare status string per leg, or extra keys ignored.

A19. L4 and an absent leg. Lines 592 to 597 reject a transfer other than `not_reached` beside authorization `not_reached` or `failed`; they say nothing about an authorization that is not recorded. Taken: allowed. Other reading: rejected.

A20. Cells that no row can satisfy. (a) `replay_already_settled` admits transfer `not_reached` (line 548), but the row must be `settled` (line 176), and L6 lists only `not_submitted` and `unknown` for transfer `not_reached` (line 626); with `not_submitted` the repeat rule rejects it (lines 180 to 181, 203 to 205). (b) `replay_in_flight` admits `not_reached` on either leg (line 550), but must be `pending` (line 177), which L6 does not list for `not_reached` (lines 622, 626). (c) The L6 row transfer `executed` (line 624) is reachable by no reviewed reason (lines 564 to 568) and the last reason row is rejected first (L5), so that row cannot be exercised. Taken: L6 and the repeat table win, the cell is not rescued. Other reading: the cell wins. Eleven generated tests that need such a pair are skipped, not counted as passes. A mutant that widens that L6 row survives the tests for the same reason.

A21. Extra input fields. Not copied to the output and not rejected. Lines 269 to 271 allow a `_vendor` field outside the evidence ceiling. Other reading: reject unknown fields.

A22. References that cannot be followed. "(§5.1)" line 140 and "(§5.2)" lines 148 to 150 point at sections that do not exist in the file; their content seems to be the unnumbered paragraphs at lines 161 to 168 and 170 to 190. "§5.5", "§5.5.4", "§7.4 of the base specification" and "x402#..." references (lines 3, 42 to 82, 237, 294) point to other documents. Nothing from them was used.

A23. Checks this interface cannot run. Signature against a key the verifier resolves (lines 206 to 207), signer key against the payee (lines 207 to 209, 232 to 233), two rows about one identity that disagree (lines 211 to 212), the advice at lines 340 to 343. The interface has no signature, no payee and no second row. Nothing is claimed about them.

A24. The identity helper. `deriveAttemptIdentity` was not asked for; it implements lines 111 to 125 and is there so the example at lines 307 to 311 can be tested. Open: how a string payload becomes bytes (UTF-8 taken), whether the digest inside the object keeps its `sha256:` prefix (line 120 says `sha256` returns `sha256:<64 hex>`, so yes), and RFC 8785 serialisation (plain sorted keys and JSON string escaping, which matches for these ASCII values). Other reading: bare hex inside the object gives other identities.

A25. Two recorded legs under L6. Line 629 "a leg and a settlement the row for that leg and status does not list" is singular. Taken: each recorded leg is checked, so the settlement must be listed for both. Other reading: only one leg is checked.

## Invented rejection codes (14)

`malformed_input`, `invalid_signing_public_key`, `invalid_attempt_identity`, `unknown_decision`, `unknown_settlement`, `final_invalid`, `pending_must_not_be_final`, `refused_field_on_accepted_row`, `missing_reason`, `unknown_reason`, `unknown_evidence_class`, `evidence_exceeds_ceiling`, `evidence_not_reproducible`, `malformed_legs`.

## Codes the text names (6)

`settlement_contradicts_reason` (line 181), `leg_contradicts_reason` (line 527 to 528), `leg_not_observed` (line 528 to 529), `unknown_leg_status` (lines 529 to 530), `unknown_leg` (line 589), `settlement_contradicts_leg` (line 629 to 630).

## Invented field names

None in `fields`. Two exported function names are invented: `deriveAttemptIdentity` and `baseCeiling`. `reproducibleCeiling` is a name from line 691; its behaviour is described in A10.
