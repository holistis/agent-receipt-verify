# Outside runs of our vector sets

Runs of our vector sets by other people, written down the way they reported them. "Ran against" means what it says: the set was run and gave this answer. A run here is not a verification of the other party's production system, and it is not an audit of this repository.

## settlement_pending (vectors/settlement-pending)

Set: vectors.json with fingerprint 94b07672bfd9 (sha256 94b07672bfd9be9335d52ac3bedd4f59bc663b30b2978d32f4bfcb1d83c1bbfe), draft 3, 41 vectors of which 36 are asserted and 5 are open.

| Date | Who | What ran | Result | Link |
|---|---|---|---|---|
| 2026-11-25 | mitaka7210 (gist owner hristovdimitri2-hub) | Our adapter vectors/settlement-pending/cross-run/kruisrun.py, unmodified (sha256 97d537f5124a75cbcca5a713fc3bc21f256bc047e1510762599bb6691236c86a), on their file test_settlement_pending_chain_before_delivery.py (37 862 bytes, sha256 3d76d8030efc10cbbfcfe3a739078ee5fa4a8af417712a583b934789f37d170a, gist revision c1cd82cc059b, 11 tests). Python 3.12.10, 08:29 UTC. | 22 same as the reference, 14 a different answer the vector allows, 0 outside what the vector allows, 5 open. The output is byte-identical to vectors/settlement-pending/cross-run/uitvoer.txt except the line that echoes the file name. | [CROSS_RUN_RESULT.md, gist revision ab695407b220](https://gist.github.com/hristovdimitri2-hub/0d2f4436cc73a14d837c39f88168a5bf/ab695407b220b176207e29789de41aec6291c91d) |

What this run does not show. In their words: it is not an independent run, because the vectors and the adapter are ours and the file and the machine are theirs; it shows that the recorded run can be reproduced and that the recorded output is what the adapter produces; and the numbers rest on our adapter, which decides what the reference answer is, and they did not audit its reading of the 41 vectors. In ours: a second, independent column needs a third party's own reading of vectors.json.

The same day we reproduced it ourselves from the raw bytes of main with the same hashes and the same command. The tally is the same and the output differs from uitvoer.txt only on line 2, the file name. That is our own check of their run, not a second run.

Our own earlier runs against earlier revisions of their file are recorded in vectors/settlement-pending/cross-run/.

## attempt-identity (vectors/attempt-identity and vectors/attempt-identity-extra)

Set: the folders vectors/attempt-identity (72 vector files, including the 22 frozen known-answer files) and vectors/attempt-identity-extra (8 vector files), at commit 0280039f00d8. They hold 30 known-answer vectors (15 right values and 15 wrong twins) and 13 canonical-variant vectors.

| Date | Who | What ran | Result | Link |
|---|---|---|---|---|
| 2026-11-24 (published 2026-11-25) | Aron (jrosgren), Polkulab (Payvetted) | Their script crossrun_holistis.py against x402-decision-record v1.0.1 (tag v1.0.1, ee2a6e9), twice: with their own rule (the request hashed as it was sent) and with an adapter they wrote for the canonical-member rules of section 5.5. Their own tests 29 of 29 OK. No network at run time. | Their own rule: 3 of the 15 right values match, 12 differ, 4 of their values equal our wrong twins, and on the 13 canonical variants 6 agree and 7 differ. Their adapter: 30 of 30 known answers agree and 13 of 13 canonical variants. | [crossruns/holistis-2026-11-24, commit 250813bdd619](https://github.com/jrosgren/x402-decision-record/tree/250813bdd6196aa0f9fa63076981d8c28d4adccd/crossruns/holistis-2026-11-24) |

What this run does not show. As their README says: with their own rule the two designs differ on purpose, because theirs hashes what was sent and section 5.5 hashes canonical members, so the differences are a design choice and not an implementation bug; the adapter is not part of their spec v1.0.1; the other vectors, which record what an implementation did across paths (about 50 by their count, 37 by ours because the 13 canonical-variant vectors were run), were not run because their verifier checks one signed record after the fact and has nothing to feed them into; the two empty-query vectors agree only because their script writes no question mark for an empty query; the request hashes they printed for the 15 raw requests have not been checked by anyone else; and the data is example data, not a production record. In ours: the 6 canonical-variant vectors that agree include the four repeated-key and order vectors, which any hash of the request as sent keeps apart, so 6 of 13 is not a measure of how close the two designs are; and we rebuilt their own rule from their v1.0.1 spec and got the same numbers for the known answers and the canonical variants, which is our own check of those numbers and not a second run; we did not rebuild their adapter, so the 30 of 30 is their number.

## Adding a run

Open an issue or a pull request with the date, the fingerprint you ran against, the command, the result and what your run does not show. We list what you report and the limits you name.

Cite as: github.com/holistis/agent-receipt-verify, RESULTS.md, 25 November 2026.
