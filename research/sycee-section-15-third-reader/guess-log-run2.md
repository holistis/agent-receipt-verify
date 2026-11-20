# Guess log for run 2, written BEFORE the reader was updated and BEFORE any recorded answer of the 48 files was opened

Target: github.com/ruiruii/sycee at commit df240da (15 commits after 632c2f56), conformance/refusal/, 48 files.

What I had read when this was written: the diff of SPEC.md (33 added, 7 removed lines), of specs/extensions/refusal-row.md (57 added, 12 removed) and of conformance/refusal/README.md (67 added, 9 removed), between 632c2f56 and df240da; plus Rachel's Slack message of 20 Nov, 6:47 PM.
What I had opened of the vectors: file names, and for the 17 files that are new or renamed (the right files, 9 accepted and 8 rejected, not their `-wrong` twins) the `input` object without the key and identity fields. I had NOT opened any `observed`, `expected` or `note` value of any file.
What I did not open: verify_known_answers.py, the new Python checker, judge.mjs, docs-parity.mjs, packages/core, any test. I extracted only SPEC.md, the extension, the README and the vectors from the commit archive.

What this run is, and is not: a regression check by the same reader that found the four disagreements, against a text that was changed in response to that finding. It is narrower than run 1. The 23 new files are read cold (inputs only); the 25 old ones are the same reader's second pass. I will report it that way.

## What changed in the reader, each traced to a sentence in the new text

C1  15.4 now lists, per reason, the statuses each leg may have. The reader applies that table. A leg the table lists with statuses is required when `legs` is present (else `leg_not_observed`); a recorded status outside the list is `leg_contradicts_reason`; a leg marked with a dash is neither required nor forbidden. This replaces my run 1 rules from G8.
C2  Section 6, item 2 ("When refused, `reason` is in the closed set. An unknown reason means the row was not produced by a conforming implementation") was already in the text at 632c2f56. My run 1 reader did not apply it, because no vector exercised it. The reader now rejects an unknown reason. The closed set is the 14 reasons of the section 5 table plus the three repeat-presentation reasons named in the extension. The code name `unreviewed_reason` comes from the README list, not from the prose.
C3  `insufficient_funds` is now `issuer_asserted` in both tables. My reader already had this from the run 1 reading of the paragraph under the table.

## Things the text still does not say (each is a guess in the reader)

G13  `legs` omitted altogether with the reason `transfer_leg_failed`. 15.4 says the reason is "pinned on both legs, because the sentence is a conjunction". The README says omitting `legs` asserts nothing, which is how `internal_error` is described. The reader rejects `transfer_leg_failed` without legs as `leg_not_observed` and accepts every other reason without legs. No file I have seen tests it.
G14  Order of checks when a row breaks more than one rule: decision, settlement, leg names, leg statuses, finality, then for a refused row the closed set, the leg table, and the evidence class. Not specified.
G15  `duplicate_payment` is a reason of the section 5 table but is not a row of the 15.4 table, where "anything else" is called an unknown reason. The reader treats it as known and pins no leg for it. This is a guess because the 15.4 table, read literally, calls it unknown.
G16  `final` when the input carries none: unchanged from G3 (`settlement !== pending`).
G17  When a refused row both omits a required leg and records another leg outside its list: `leg_not_observed` first. Not specified.

## Predictions, made before the run

P1  All 48 files agree with the reader. Reason: the new text and the new files were written after the first reading, and I read the 17 new inputs cold only to the point of finding no rule I did not already have.
P2  If anything disagrees it is one of: (a) a file for `unreviewed_reason` (code name), (b) a `final` value for `settlement: unknown` (G16), (c) a file that pins a leg order (G17).
P3  The 15 planted mistakes that survived 25 files: I expect at most 2 still survive 48 files. The likeliest survivors are the two that touch `evidence_class` supplied in the input, because the only new files I saw do not supply one.
