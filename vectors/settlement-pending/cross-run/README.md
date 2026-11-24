# Cross-run: draft 3 against the decision logic of a published gist

Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending/cross-run, 2026-11-24.

This folder records three runs of the vectors of draft 3 in the parent folder, answered by the decision logic that mitaka7210 published as a runnable gist (owner hristovdimitri2-hub):
https://gist.github.com/hristovdimitri2-hub/0d2f4436cc73a14d837c39f88168a5bf

The gist is the work of its author and its licence is his: the current revision of the file starts with an SPDX-License-Identifier: MIT line and says that this is the licence of the file itself. This repository does not contain the file. The file says that it is a redacted extraction of the decision logic of the Kristo Intelligence production code, with the transport removed, that it is not the production code, that it uses the standard library only and that it makes no network call.

The set was run against that logic. It was not confirmed by it. The adapter is ours.

This folder is in the repository but not in the npm package.

## The runs

1. First revision of the file: gist revision e8867f7a92b29f9ddc2c0f2f37e55821af654d93, 22973 bytes, sha256 d76537a70102c6399deb9b8be9e8ceae3a90728e2e7d6004cef5840edc4b524e, seven tests. Of the 36 asserted vectors, 22 got the answer of the reference, 8 a different answer that the vector allows and 6 a delivery that the vector does not allow: four about the binding of a transfer to a payment (two on each rail) and two about amounts above what a float holds exactly. The output is in history/uitvoer-first-revision.txt.
2. Revision of the file run here (23 November): gist revision 6ba3a8e404b39095bffa2545f7cfb4c46927ddf3, 30900 bytes, sha256 558351e6daf4faaa6ffa8293bf3cf593e030ff0933c0eea00d7fa09e33a7a1e2, nine tests. The output is in history/uitvoer-second-revision.txt.
3. Revision of 24 November: gist revision c1cd82cc059b9b8141e6aae40f7f68655985eeec, 37862 bytes, sha256 3d76d8030efc10cbbfcfe3a739078ee5fa4a8af417712a583b934789f37d170a, eleven tests. The adapter passes the nonce of the authorization rail into decide(). Of the 36 asserted vectors, 22 got the answer of the reference, 14 a different answer that the vector allows and 0 a delivery that the vector does not allow. This is the run recorded below.

Between the first and second the file was revised; the gist history lists revisions c9f5612e at 15:29 UTC and 6ba3a8e4 at 15:37 UTC on 23 November 2026. Between the second and third it was revised twice more: 34e58207 at 05:51 UTC on 24 November added the nonce binding (146 lines added), and c1cd82cc at 06:22 UTC the same day fixed one line of its own REVISIONS block, a date it had recorded for itself as 24 November that mitaka7210 found should read 23 November; nothing about the decision logic or the two new tests changed between those two. The file has a REVISIONS block of its own. It says that the first revision had two defects found by a later external review (the decision function never checked the sender, and amounts were compared as floats), that the second revision adds the payer binding and a comparison in atomic units, and that the third adds the nonce binding of the authorization rail and its two tests. The hash that the block gives for the first revision is the hash that was measured here. The intermediate revisions (c9f5612e and 34e58207) were not run separately.

## What was run

- The revision of 24 November of the gist file test_settlement_pending_chain_before_delivery.py, raw bytes as served by gist.githubusercontent.com, hash and size as in the output below. The file is not copied into this repository; kruisrun.py loads it from a path you give it.
- Python 3.12.10, started with `python -I`, on 24 November 2026.
- The file imports only json, sys, dataclasses and typing, and its own eleven tests pass.
- Command: `python -I kruisrun.py ../vectors.json path/to/test_settlement_pending_chain_before_delivery.py --sha256 3d76d8030efc10cbbfcfe3a739078ee5fa4a8af417712a583b934789f37d170a`

The adapter runs the file you give it as Python code. Read it first. With --sha256 the adapter refuses a file with another hash and exits with code 2 without running it; without --sha256 it prints a warning on the error output and runs the file anyway. The adapter speaks both revisions, so the first run can be reproduced with the first file and its hash.

## What the adapter assumes, and does not attribute to him

- The revision of 23 November has no adoption by nonce. For a vector where the same signed payment comes back, the adapter hands his decide() the hash that the nonce lookup found, as a pending response. From the revision of 24 November the file takes the nonce itself: the adapter passes the nonce of the authorization rail into decide(nonce=...), and the file requires the receipt to be the one that consumed it.
- His file has no unreadable-chain state. A chain that was not measured is given to him as a chain without a receipt, which his file answers with a hold.
- Depth: a deep receipt is 11 confirmations and a shallow one is 2; his file asks for 3.
- Amounts: the current revision takes integers in atomic units, so the adapter hands over the base units unchanged. The first revision took floats, so for that revision the adapter divides by 1e6. The quote asset is not a parameter of his decide(): the right token is given as his USDC constant and any other token as a synthetic address.
- His file has no rail. Its decide() takes a payer and, from the revision of 24 November, a nonce. On the proof rail the adapter passes the payer of the payment and no nonce, because no authorization was signed there. On the authorization rail the adapter passes the payer named by the receipt's own transfer and the nonce of the payment: that rail binds a transfer to a payment by a nonce, and from the revision of 24 November that binding is in the gist and is measured here.
- His file cannot express a sender that cannot be read. For the vector about that, the adapter hands the transfer the default sender of his file, so his answer to that vector says little.
- The durable claim is emulated with his own EffectStore, pre-marked as delivered, and then his handle() is used. His EffectStore refuses a hash that was delivered, so the four vectors about a hash that was already delivered get the answer of the reference, on the path where the hash is named and on the path where it is found by nonce.
- His logic also verifies the chain when the settle response says success. The reference of this set delivers a plain success at face value (rule R01), and no vector tests that difference.

## Result

The output of the run on the revision of 24 November, byte for byte as kruisrun.py printed it (uitvoer.txt):

```
cross-run: the vectors of draft 3 against the decision logic of the gist of mitaka7210
gist file: test_settlement_pending_chain_before_delivery.py, 37862 bytes, sha256 3d76d8030efc10cbbfcfe3a739078ee5fa4a8af417712a583b934789f37d170a
python: 3.12.10, started with -I
vectors: 41, asserted 36, open 5
asserted vectors, answer of his logic compared with ours:
  same answer as the reference: 22
  a different answer that the vector allows (refuse or hold): 14
  outside what the vector allows: 0
  of those, without an explanation in this adapter: 0
open vectors (nothing is asserted, his answer is shown): 5

every vector where his answer is not the reference answer:
  allowed wrong-recipient-refuse                         reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed underpaid-by-one-refuse                        reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed no-transfer-event-refuse                       reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  open    pending-without-hash-open                      reference OPEN    his logic deny          (settlement_pending_without_transaction)  [open in this set; his file denies it]
  open    reverted-shallow-open                          reference OPEN    his logic deny          (receipt_reverted)  [open in this set; his file denies a reverted transaction at any depth]
  allowed old-payment-of-ours-refuse                     reference REFUSE  his logic indeterminate (nonce_not_consumed_here)
  allowed old-payment-overpaid-refuse                    reference REFUSE  his logic indeterminate (nonce_not_consumed_here)
  open    transfer-nonce-unreadable-open                 reference OPEN    his logic indeterminate (nonce_not_consumed_here)  [his nonce check needs a receipt that names an authorization; this vector has none to name, so it is never the one that consumed the nonce]
  allowed wrong-recipient-large-amount-refuse            reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed underpaid-beyond-safe-integer-refuse           reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed proof-rail-other-payer-refuse                  reference REFUSE  his logic indeterminate (payer_mismatch)
  allowed wrong-token-refuse                             reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  open    malformed-hash-open                            reference OPEN    his logic deny          (settlement_pending_without_transaction)  [open in this set; his file denies it]
  allowed malformed-hash-not-held                        reference OPEN    his logic deny          (settlement_pending_without_transaction)
  allowed underpaid-18-decimals-refuse                   reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  open    proof-rail-payer-unreadable-open               reference OPEN    his logic allow         (no reason given)  [his file cannot express a sender that is unreadable: the adapter hands it the default sender]
  allowed proof-rail-near-miss-payer-refuse              reference REFUSE  his logic indeterminate (payer_mismatch)
  allowed wrong-token-near-miss-proof-rail-refuse        reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed short-hash-not-held                            reference OPEN    his logic deny          (settlement_pending_without_transaction)
```

In words: of the 36 asserted vectors, 22 get the answer of the reference, 14 get a different answer that the vector explicitly allows (his logic holds where the reference refuses, or refuses where the reference leaves a case open) and 0 get a delivery that the vector does not allow. Of the 5 open vectors, nothing is asserted; his logic denies three of them and delivers one that needs a readable sender his file cannot express, and holds one where the nonce it would need to consume cannot be read.

## What changed between the first two runs

The four vectors about the binding on the proof rail and the amounts above what a float holds now get an answer that the vector allows: his file holds a transfer from another payer (payer_mismatch) and holds an amount that is one unit short, also above 2^53. The two vectors about the nonce on the authorization rail were outside what the vector allows in the revision run here, as that revision has no nonce binding. The revision of 24 November adds it and the adapter passes the nonce, so that class is measured from the third run on. The first run showed six deliveries that the vectors do not allow: four about the binding of a transfer to a payment and two about floats. Four of them are gone (the two on the proof rail and the two about floats). The remaining two sat on the rail whose binding the second revision did not yet carry.

## Where the two answers differ

On 19 of the 41 vectors the answer of his logic is not the answer of the reference:

- 14 are a different answer that the vector allows. For a wrong recipient, a wrong token, an amount that is too small, a missing transfer, a transfer from another payer and a transfer that consumed another nonce, his logic holds (indeterminate) where the reference refuses, and for the two vectors about a string that is not a hash his logic refuses where the reference leaves the case open. Neither holding nor refusing delivers, and the specification does not decide between them, so the vectors allow both. These are the places where a specification could pin one answer.
- 5 are open vectors, where nothing is asserted: his logic denies a pending response without a hash, a malformed hash and a reverted transaction at any depth, holds a transfer whose nonce cannot be read, and delivers when a payer cannot be read.
- 0 are outside what the vector allows: in the revision of 24 November his logic no longer delivers on any vector the reference does not also allow.

A transfer that belongs to another payment is held by his gist on the proof rail. On the authorization rail the revision of 23 November delivers, because it has no nonce binding, and the vectors for that class allow a hold only because the specification does not decide between refusing and holding. The revision of 24 November holds on it as well, so a seller that holds on that class on both rails is now measured.

## What this does not show

- Not a verification of his production code. The one-hash-one-delivery claim is described in his message and tested here only through his own EffectStore. The nonce binding and the payer binding are now in the gist itself, read and run here, not taken from his message; they are still not checked against a live token or live transactions (see the family README).
- Not independent: the adapter, the vectors and this README were written by the same party.
- Each run is against one dated revision of the gist file (the hashes above). The intermediate revisions (c9f5612e and 34e58207) were not run.
- The numbers 22, 14 and 0, and 22, 12 and 2 for the second run, and 22, 8 and 6 for the first run, rest on a script that no automated test runs, because the continuous integration has no Python. A test only checks that this README contains the recorded output and that the history file names the hash of the first revision.
