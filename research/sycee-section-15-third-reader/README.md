# Third reader for the sycee section 15 vectors

Cite as: github.com/holistis/agent-receipt-verify, research/sycee-section-15-third-reader, 2026-11-20.

Subject: github.com/ruiruii/sycee at commit 632c2f56, conformance/refusal, 25 files. The sha256 of the list of the 25 file hashes is 76aa61af5928a6136cc111b59b64c3a77f3b6dd63a49b63a858babf15cdbe409 (vectors-sha256.txt).

## What was done

I wrote a reader from the text of specs/extensions/refusal-row.md and SPEC.md only, wrote down every guess before running it, ran it once on the 25 files and compared the output with the recorded answers using the twin rule.

I did not open verify_known_answers.py, verify-known-answers.mjs, judge.mjs or anything under packages/. Before writing the guess log I had opened the key names and the input object of each vector, because a reader needs the input format, and the README, which is also where my rejection codes come from since the prose names none. I had not opened any recorded answer. The reader code stays private. Its sha256 is f26a869308319d1d7d33d3de9fd134158d8d3f58d34a2f3c00e9e3536dffa816.

## First run

21 of 25 files agree. 4 do not: three vectors, one of them together with its wrong twin. All eight wrong twins differ from their right twin.

1. reject-accepted-never-submitted. A row with decision accepted and settlement not_submitted passes my reader. Section 13 of the extension lists purchase_not_settled as producing accepted (not_submitted), and I found no sentence that forbids that combination. The vector expects a rejection with finality_accepted_not_submitted.

2. reject-risk-policy-after-submission. A risk_policy_rejected row with an executed authorization passes it as well. Section 15.4 says a reason that makes no leg claim must not carry observations that contradict that, and names wrong_amount and authorization_expired as examples. It does not say what risk_policy_rejected means for the legs. The table of permitted statuses, REQUIRED_LEG_STATUS, exists in the code and not in the prose.

3. permit2-transfer-unread and its wrong twin. The file records authorization unknown and transfer failed. I get leg_contradicts_reason there, because the table in 15.3 defines transfer_leg_failed as the authorization leg executed and the transfer leg not. The vector accepts it. Two small things on the same file: its name says the transfer is unread, but the file records the transfer as failed and the authorization as unknown; and the sentence in 15.3 about learning nothing is about the transfer leg.

In a diagnostic copy, written after I had seen the answers, flipping exactly these three decisions makes my reader agree with all 25 files (diagnose-output.txt). That shows what the text would have to say for a reader to land on the vectors. It does not show that those three readings are the right ones.

Before the run I wrote down that the first three would disagree and that everything else would agree. I also expected the default of final for settlement unknown might fail, and it did not.

## Guesses

The full log, written before the run, is guess-log.md. Its sha256 was taken at 2026-11-20T15:40:52Z by my own clock before the first run; the commit date of this folder is the only outside timestamp. In short:

- No rejection codes are named in the prose, and legs are written legs.<leg>.status in 15.4 while the files use a bare string.
- When the input carries no final, the prose gives no default. Only pending gets false from me.
- Accepted rows: the evidence class is not stated, so I returned null.
- Evidence classes have no stated order. The enum order is what I took.
- Default evidence class is the reproducible ceiling (15.7). I used issuer_asserted for transfer_leg_failed and for insufficient_funds, and chain_verifiable for duplicate_payment even though the general rule in 15.5, read literally, also bears on it.
- Which statuses each reason permits is not in the prose. I required executed and failed for transfer_leg_failed, executed for nonce_already_used, no executed leg for wrong_amount and authorization_expired, and no rule for anything else.
- Invalid decision or settlement values: rejected, with codes I made up, because the prose names none.

## Do the vectors pin the rules down

I planted 21 plausible mistakes, one at a time, in the reader that agrees with all 25 files. 15 of them still pass every vector.

Caught: the base ceiling as the default for transfer_leg_failed, a missing leg, an executed transfer, a default final of false for unknown, a default final of false for not_submitted, a supplied evidence class that is ignored.

Pass all 25 files: insufficient_funds claimed at chain_verifiable; duplicate_payment, invalid_signature, wrong_recipient, malformed_payload and authorization_expired with a different default class; an unknown reason that does not fail closed; nonce_already_used with any leg status; authorization_expired with an executed leg; transfer_leg_failed with transfer unknown (the mutant 15.7 names as treating unknown as failed); transfer_leg_failed with transfer not_reached; rejecting every pending row; rejecting pending with final true only for one reason; accepting an invalid decision value; accepting an invalid settlement value.

For context: 6 of the 14 closed reasons appear in any vector, the only vector with settlement pending is a rejected one, and one vector supplies an evidence class in its input. The 21 mistakes are my own picks and some of them concern section 5 and section 4 and not section 15, so the 25 files may well be meant as a seed and not as the whole set.

## Smaller things from reading

- SPEC.md at this commit has no section 15. It is in specs/extensions/refusal-row.md. To write the reader I also needed section 4 (final, settlement, the legs object) and the README.
- Section 5 says six reasons also exist for a repeat presentation, and the table lists three.
- SPEC.md 5.5.2 lists insufficient_funds at chain_verifiable and has no transfer_leg_failed. The extension says the honest claim for insufficient_funds is issuer_asserted. I followed the extension. No vector covers it.

## Second run, against sycee df240da

You fixed the four disagreements in your repository and asked for the reader to be run again against commit df240da, which has 48 files in conformance/refusal. 26 of them are new or renamed; three of the first 25 were replaced. The sha256 of the list of the 48 file hashes is f61fa0e035420e333ede625ceefb9767ea5cf0be469300ade16b41190e59ac8d (vectors-sha256-run2.txt). The guess log for this run is guess-log-run2.md. Its sha256 and the sha256 of the updated reader were taken at 2026-11-20T18:26:38Z by my own clock, before the run, and the commit date of this folder is again the only outside timestamp.

What this run is: a regression check, not a fresh independent reading. It is the same reader that found the four disagreements, run against a text that changed because of them. Before writing the guess log I had opened the input of the 17 right files that are new or renamed, and no recorded answer. I did not open the new Python checker, judge.mjs or docs-parity.mjs, and I extracted only SPEC.md, the extension, the README and the vectors from the commit.

The reader changed in three places, each traced to a sentence in guess-log-run2.md: it applies the table of permitted leg statuses in 15.4, it rejects an unknown reason as unreviewed_reason, and it keeps insufficient_funds at issuer_asserted, which it already did. The second change corrects a miss of mine. Section 6 item 2 was already in the text at 632c2f56, and my first reader did not apply it because no vector tested it.

Result: 48 of 48 files agree, including the 16 rejections with their codes and the 16 wrong twins (comparison-run-2.txt). I predicted this before the run, and I predicted that if anything disagreed it would be the unreviewed_reason code, a final value for settlement unknown, or the order of two leg errors. None did.

Planted mistakes: the same 21 as in the first run (diagnose-output-run2.txt). 14 of the 15 that passed all 25 files are now caught; I expected at most two to survive. One still passes all 48 files: a reader that rejects a pending row with final true only when the reason is facilitator_timeout. The three vectors with a pending settlement all use facilitator_timeout, and section 6 item 4 says final is false whenever settlement is pending, whatever the reason. A refused row with another reason such as internal_error, settlement pending and final true, expecting finality_pending_is_not_final, would catch it.

Five of the 17 reasons in the closed set have no vector: authorization_not_yet_valid, commercial_refusal, could_not_compare, replay_already_settled and replay_in_flight. Three mistakes that I chose after seeing the new text, so not among the 21, pass all 48 files for that reason: authorization_not_yet_valid with another default class, commercial_refusal with an executed authorization, and replay_already_settled with an authorization that was not reached.

Three things in the text:

- conformance/refusal/README.md says in one place that the set is now 40 files and in another that it has 48.
- The table in 15.4 has no row for duplicate_payment, which is a reason in section 5 and has a vector, and its last row calls any other reason unknown.
- Section 6 item 2 and the last row of the ceiling table say different things about an unknown reason. The first calls the row not conforming, the second gives it issuer_asserted as a default. The vector reject-unreviewed-reason follows the first, and so does the updated reader.

This run does not show that the 48 files are enough: the rules and reasons without a vector are not tested by them, as listed above. The reader code stays private. Passages relied on are in sources-run2.txt.

## What this does not show

I did not run the JavaScript or the Python implementation, so this says nothing about whether they agree with each other beyond what the recorded answers say. One person wrote this reader in one sitting, after the vector inputs and the README were open, so it is independent of your code but not of your files. No real receipts and no replay test were used.

## Files

- guess-log.md, the guesses and predictions as written before the run
- run-1-output.json, what the reader returned
- comparison-run-1.txt, the comparison with the recorded answers (labels translated from Dutch)
- diagnose-output.txt, the three flips and the 21 planted mistakes
- vectors-sha256.txt, the hash of each of the 25 files
- hashes-before-run.txt and sources.txt, the hashes taken before the run and the passages relied on
- guess-log-run2.md, run-2-output.json, comparison-run-2.txt, diagnose-output-run2.txt, vectors-sha256-run2.txt, hashes-before-run-run2.txt and sources-run2.txt: the same files for the second run
