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

## Adding a run

Open an issue or a pull request with the date, the fingerprint you ran against, the command, the result and what your run does not show. We list what you report and the limits you name.

Cite as: github.com/holistis/agent-receipt-verify, RESULTS.md, 25 November 2026.
