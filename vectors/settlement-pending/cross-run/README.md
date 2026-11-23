# Cross-run: draft 3 against the decision logic of a published gist

Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending/cross-run, 2026-11-23.

This folder records two runs of the vectors of draft 3 in the parent folder, answered by the decision logic that mitaka7210 published as a runnable gist (owner hristovdimitri2-hub):
https://gist.github.com/hristovdimitri2-hub/0d2f4436cc73a14d837c39f88168a5bf

The gist is the work of its author and its licence is his: the current revision of the file starts with an SPDX-License-Identifier: MIT line and says that this is the licence of the file itself. This repository does not contain the file. The file says that it is a redacted extraction of the decision logic of the Kristo Intelligence production code, with the transport removed, that it is not the production code, that it uses the standard library only and that it makes no network call.

The set was run against that logic. It was not verified by it. The adapter is ours.

This folder is in the repository but not in the npm package.

## The two runs

1. First revision of the file: gist revision e8867f7a92b29f9ddc2c0f2f37e55821af654d93, 22973 bytes, sha256 d76537a70102c6399deb9b8be9e8ceae3a90728e2e7d6004cef5840edc4b524e, seven tests. Of the 36 asserted vectors, 22 got the answer of the reference, 8 a different answer that the vector allows and 6 a delivery that the vector does not allow: four about the binding of a transfer to a payment (two on each rail) and two about amounts above what a float holds exactly. The output is in history/uitvoer-first-revision.txt.
2. Current revision of the file: gist revision 6ba3a8e404b39095bffa2545f7cfb4c46927ddf3, 30900 bytes, sha256 558351e6daf4faaa6ffa8293bf3cf593e030ff0933c0eea00d7fa09e33a7a1e2, nine tests. This is the run recorded below.

Between the two the file was revised; the gist history lists revisions c9f5612e at 15:29 UTC and 6ba3a8e4 at 15:37 UTC on 23 November 2026. The file has a REVISIONS block of its own. It says that the first revision had two defects found by a later external review (the decision function never checked the sender, and amounts were compared as floats), that the second revision adds the payer binding and a comparison in atomic units, and that the revision run here adds that block and nothing else of substance. The hash that the block gives for the first revision is the hash that was measured here. The intermediate revision was not run separately.

## What was run

- The current gist file test_settlement_pending_chain_before_delivery.py, raw bytes as served by gist.githubusercontent.com, hash and size as in the output below. The file is not copied into this repository; kruisrun.py loads it from a path you give it.
- Python 3.12.10, started with `python -I`, on 23 November 2026.
- The file imports only json, sys, dataclasses and typing, and its own nine tests pass.
- Command: `python -I kruisrun.py ../vectors.json path/to/test_settlement_pending_chain_before_delivery.py --sha256 558351e6daf4faaa6ffa8293bf3cf593e030ff0933c0eea00d7fa09e33a7a1e2`

The adapter runs the file you give it as Python code. Read it first. With --sha256 the adapter refuses a file with another hash and exits with code 2 without running it; without --sha256 it prints a warning on the error output and runs the file anyway. The adapter speaks both revisions, so the first run can be reproduced with the first file and its hash.

## What the adapter assumes, and does not attribute to him

- His file has no adoption by nonce. For a vector where the same signed payment comes back, the adapter hands his decide() the hash that the nonce lookup found, as a pending response.
- His file has no unreadable-chain state. A chain that was not measured is given to him as a chain without a receipt, which his file answers with a hold.
- Depth: a deep receipt is 11 confirmations and a shallow one is 2; his file asks for 3.
- Amounts: the current revision takes integers in atomic units, so the adapter hands over the base units unchanged. The first revision took floats, so for that revision the adapter divides by 1e6. The quote asset is not a parameter of his decide(): the right token is given as his USDC constant and any other token as a synthetic address.
- His file has no rail. Its decide() takes a payer. On the proof rail the adapter passes the payer of the payment. On the authorization rail it passes none, because that rail binds a transfer to a payment by a nonce, and the nonce binding is described in his message to us as part of his production code. It is not in the gist, so it was not measured here.
- His file cannot express a sender that cannot be read. For the vector about that, the adapter hands the transfer the default sender of his file, so his answer to that vector says little.
- The durable claim is emulated with his own EffectStore, pre-marked as delivered, and then his handle() is used. His EffectStore refuses a hash that was delivered, so the four vectors about a hash that was already delivered get the answer of the reference, on the path where the hash is named and on the path where it is found by nonce.
- His logic also verifies the chain when the settle response says success. The reference of this set delivers a plain success at face value (rule R01), and no vector tests that difference.

## Result

The output of the run on the current revision, byte for byte as kruisrun.py printed it (uitvoer.txt):

```
cross-run: the vectors of draft 3 against the decision logic of the gist of mitaka7210
gist file: test_settlement_pending_chain_before_delivery.py, 30900 bytes, sha256 558351e6daf4faaa6ffa8293bf3cf593e030ff0933c0eea00d7fa09e33a7a1e2
python: 3.12.10, started with -I
vectors: 41, asserted 36, open 5
asserted vectors, answer of his logic compared with ours:
  same answer as the reference: 22
  a different answer that the vector allows (refuse or hold): 12
  outside what the vector allows: 2
  of those, without an explanation in this adapter: 0
open vectors (nothing is asserted, his answer is shown): 5

every vector where his answer is not the reference answer:
  allowed wrong-recipient-refuse                         reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed underpaid-by-one-refuse                        reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed no-transfer-event-refuse                       reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  open    pending-without-hash-open                      reference OPEN    his logic deny          (settlement_pending_without_transaction)  [open in this set; his file denies it]
  open    reverted-shallow-open                          reference OPEN    his logic deny          (receipt_reverted)  [open in this set; his file denies a reverted transaction at any depth]
  outside old-payment-of-ours-refuse                     reference REFUSE  his logic allow         (no reason given)  [not in his file: the nonce binding of the authorization rail is described in his message and lives in his production code]
  outside old-payment-overpaid-refuse                    reference REFUSE  his logic allow         (no reason given)  [not in his file: the nonce binding of the authorization rail is described in his message and lives in his production code]
  open    transfer-nonce-unreadable-open                 reference OPEN    his logic allow         (no reason given)  [not in his file: the nonce binding of the authorization rail is described in his message and lives in his production code]
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

In words: of the 36 asserted vectors, 22 get the answer of the reference, 12 get a different answer that the vector explicitly allows (his logic holds where the reference refuses, or refuses where the reference leaves a case open) and 2 get a delivery that the vector does not allow. Both of those are about a transfer that belongs to another payment on the authorization rail, which needs a nonce that his file does not contain. Of the 5 open vectors, nothing is asserted; his logic denies three of them and delivers two that need a binding or a readable sender that his file cannot express.

## What changed between the two runs

The four vectors about the binding on the proof rail and the amounts above what a float holds now get an answer that the vector allows: his file holds a transfer from another payer (payer_mismatch) and holds an amount that is one unit short, also above 2^53. The two vectors about the nonce on the authorization rail are still outside what the vector allows, as the file still has no nonce binding. The first run showed six deliveries that the vectors do not allow: four about the binding of a transfer to a payment and two about floats. Four of them are gone (the two on the proof rail and the two about floats). The remaining two sit on the rail whose binding the file does not carry.

## Where the two answers differ

On 19 of the 41 vectors the answer of his logic is not the answer of the reference:

- 12 are a different answer that the vector allows. For a wrong recipient, a wrong token, an amount that is too small, a missing transfer and a transfer from another payer, his logic holds (indeterminate) where the reference refuses, and for the two vectors about a string that is not a hash his logic refuses where the reference leaves the case open. Neither holding nor refusing delivers, and the specification does not decide between them, so the vectors allow both. These are the places where a specification could pin one answer.
- 5 are open vectors, where nothing is asserted: his logic denies a pending response without a hash, a malformed hash and a reverted transaction at any depth, and delivers when a nonce or a payer cannot be read.
- 2 are outside what the vector allows: his file delivers. They are the two transfers that belong to another payment on the authorization rail.

A transfer that belongs to another payment is held by his current file on the proof rail. On the authorization rail his file delivers, because it has no nonce binding, and the vectors for that class allow a hold only because the specification does not decide between refusing and holding. Nothing measured here shows a seller that holds on such a transfer on the authorization rail.

## What this does not show

- Not a verification of his production code. The binding by nonce and the one-hash-one-delivery claim are described in his message and tested here only where his gist has them (the claim, through his EffectStore; the payer binding, in the current revision).
- Not independent: the adapter, the vectors and this README were written by the same party.
- Two runs, each against one dated revision of the gist file (the hashes above). The intermediate revision was not run.
- The numbers 22, 12 and 2, and 22, 8 and 6 for the first run, rest on a script that no automated test runs, because the continuous integration has no Python. A test only checks that this README contains the recorded output and that the history file names the hash of the first revision.
