# Outside runs of our vector sets

Runs of our vector sets by other people, written down the way they reported them. "Ran against" means what it says: the set was run and gave this answer. A run here is not a verification of the other party's production system, and it is not an audit of this repository.

## settlement_pending (vectors/settlement-pending)

Set: vectors.json with fingerprint 94b07672bfd9 (sha256 94b07672bfd9be9335d52ac3bedd4f59bc663b30b2978d32f4bfcb1d83c1bbfe), draft 3, 41 vectors of which 36 are asserted and 5 are open.

| Date | Who | What ran | Result | Link |
|---|---|---|---|---|
| 2026-11-25 | mitaka7210 (gist owner hristovdimitri2-hub) | Our adapter vectors/settlement-pending/cross-run/kruisrun.py, unmodified (sha256 97d537f5124a75cbcca5a713fc3bc21f256bc047e1510762599bb6691236c86a), on their file test_settlement_pending_chain_before_delivery.py (37 862 bytes, sha256 3d76d8030efc10cbbfcfe3a739078ee5fa4a8af417712a583b934789f37d170a, gist revision c1cd82cc059b, 11 tests). Python 3.12.10, 08:29 UTC. | 22 same as the reference, 14 a different answer the vector allows, 0 outside what the vector allows, 5 open. The output is byte-identical to vectors/settlement-pending/cross-run/uitvoer.txt except the line that echoes the file name. | [CROSS_RUN_RESULT.md, gist revision ab695407b220](https://gist.github.com/hristovdimitri2-hub/0d2f4436cc73a14d837c39f88168a5bf/ab695407b220b176207e29789de41aec6291c91d) |
| 2026-11-25 (later the same day) | mitaka7210 (gist owner hristovdimitri2-hub) | Their own reader our_own_reading.py (stdlib only, sha256 8980ceaab81d78e0d9be519f31dbb093da9247abaec72a9d84b9fb0aa3a6e8a9), written without our adapter. It parses vectors.json itself and applies the decision logic of their file test_settlement_pending_chain_before_delivery.py in its revision v5 (46 890 bytes, sha256 ccdfea67502fd2204502dfe72b4bc5e83ed8ece67b1ed19c690d580e91d0d666, 13 tests), gist revision af6af9ee149f. | 22 same as the reference, 14 a different answer the vector allows, 0 outside what the vector allows, 5 open. Their first run of this reader on the earlier revision v4 of their file gave 19, 14, 3 and 5. The three outside were one defect in their file, not in our set: a retry that presented an already used authorization was refused instead of looked up on the chain. They fixed it in v5 and added two tests. | [OUR_OWN_READING.md, gist revision af6af9ee149f](https://gist.github.com/hristovdimitri2-hub/0d2f4436cc73a14d837c39f88168a5bf/af6af9ee149faf5e976b6664c0296bb9f46c5150) |

What this run does not show. In their words: it is not an independent run, because the vectors and the adapter are ours and the file and the machine are theirs; it shows that the recorded run can be reproduced and that the recorded output is what the adapter produces; and the numbers rest on our adapter, which decides what the reference answer is, and they did not audit its reading of the 41 vectors. In ours: a second, independent column needs a third party's own reading of vectors.json.

The same day we reproduced it ourselves from the raw bytes of main with the same hashes and the same command. The tally is the same and the output differs from uitvoer.txt only on line 2, the file name. That is our own check of their run, not a second run.

The second row is the reading of vectors.json that does not go through our adapter, which the paragraph above said was missing. What it does not show, in their words: it is not independent of them, because the vectors are ours while the decision logic and the reader are theirs, so it removes one translation and not the stake of the author; it is one dated revision of their file and one dated revision of the set; and the reader makes ten numbered reading decisions, two of them for states their file has no equivalent for, which anyone who disagrees can dispute. On 25 November we ran their reader from the raw bytes of that gist revision on vectors.json of our main (sha256 94b07672bfd9be9335d52ac3bedd4f59bc663b30b2978d32f4bfcb1d83c1bbfe) and got the same four numbers, and their 13 tests pass on our machine. That is our own check of their run, not a third run. The first row stays correct as history: it names revision c1cd82cc059b of their file, and the second row ran against v5.

Our own earlier runs against earlier revisions of their file are recorded in vectors/settlement-pending/cross-run/.

## Adding a run

Open an issue or a pull request with the date, the fingerprint you ran against, the command, the result and what your run does not show. We list what you report and the limits you name.

Cite as: github.com/holistis/agent-receipt-verify, RESULTS.md, 25 November 2026.
