# Cross-run: draft 3 against the decision logic of a published gist

Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending/cross-run, 2026-11-23.

This folder records one run: the vectors of draft 3 in the parent folder, answered by the decision logic that mitaka7210 published as a runnable gist (owner hristovdimitri2-hub):
https://gist.github.com/hristovdimitri2-hub/0d2f4436cc73a14d837c39f88168a5bf

The file calls itself a redacted extraction of the decision logic of the Kristo Intelligence production code, with the transport removed, and says it is not the production code. On licence: the file names MIT only for the production source it was extracted from; mitaka7210 describes the gist as "runnable, standard library only, MIT" in his Slack message of 23 November 2026.

The set was run against that logic. It was not verified by it, and he has not checked this folder. The adapter is ours.

## What was run

- The gist file test_settlement_pending_chain_before_delivery.py, 22973 bytes, sha256 d76537a70102c6399deb9b8be9e8ceae3a90728e2e7d6004cef5840edc4b524e. Gist revision e8867f7a92b29f9ddc2c0f2f37e55821af654d93 as listed by the GitHub API on 23 November 2026, raw bytes as served by gist.githubusercontent.com. The file is not copied into this repository; kruisrun.py loads it from a path you give it.
- Python 3.12.10, started with `python -I`, on 23 November 2026.
- The file imports only json, sys, dataclasses and typing, and its own seven tests pass.
- Command: `python -I kruisrun.py ../vectors.json path/to/test_settlement_pending_chain_before_delivery.py`

## What the adapter assumes, and does not attribute to him

- His file has no adoption by nonce. For a vector where the same signed payment comes back, the adapter hands his decide() the hash that the nonce lookup found, as a pending response.
- His file has no unreadable-chain state. A chain that was not measured is given to him as a chain without a receipt, which his file answers with a hold.
- Depth: a deep receipt is 11 confirmations and a shallow one is 2; his file asks for 3.
- Amounts are base units divided by 1e6 and given as floats, as his file expects USDC. The quote asset is not a parameter of his decide(): the right token is given as his USDC constant and any other token as a synthetic address.
- His file has no rail and does not read the sender of a transfer. The rail field is ignored and the payer is passed but never compared. The binding of a transfer to a payment, by nonce on the authorization rail and by payer on the proof rail, is described in his message to us as part of his production code. It is not in the gist, so it was not measured here.
- The durable claim is emulated with his own EffectStore, pre-marked as delivered, and then his handle() is used. His EffectStore refuses a hash that was delivered, so the four vectors about a hash that was already delivered get the answer of the reference, on the path where the hash is named and on the path where it is found by nonce.
- His logic also verifies the chain when the settle response says success. The reference of this set delivers a plain success at face value (rule R01), and no vector tests that difference.

## Result

The output of the run, byte for byte as kruisrun.py printed it (uitvoer.txt):

```
cross-run: the vectors of draft 3 against the decision logic of the gist of mitaka7210
gist file: test_settlement_pending_chain_before_delivery.py, 22973 bytes, sha256 d76537a70102c6399deb9b8be9e8ceae3a90728e2e7d6004cef5840edc4b524e
python: 3.12.10, started with -I
vectors: 41, asserted 36, open 5
asserted vectors, answer of his logic compared with ours:
  same answer as the reference: 22
  a different answer that the vector allows (refuse or hold): 8
  outside what the vector allows: 6
  of those, without an explanation in this adapter: 0
open vectors (nothing is asserted, his answer is shown): 5

every vector where his answer is not the reference answer:
  allowed wrong-recipient-refuse                         reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed underpaid-by-one-refuse                        reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed no-transfer-event-refuse                       reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  open    pending-without-hash-open                      reference OPEN    his logic deny          (settlement_pending_without_transaction)  [open in this set; his file denies it]
  open    reverted-shallow-open                          reference OPEN    his logic deny          (receipt_reverted)  [open in this set; his file denies a reverted transaction at any depth]
  DIFFERS old-payment-of-ours-refuse                     reference REFUSE  his logic allow         (no reason given)  [not in his file: the binding of a transfer to a payment (nonce on the authorization rail, payer on the proof rail) is described in his message and lives in his production code]
  DIFFERS old-payment-overpaid-refuse                    reference REFUSE  his logic allow         (no reason given)  [not in his file: the binding of a transfer to a payment (nonce on the authorization rail, payer on the proof rail) is described in his message and lives in his production code]
  open    transfer-nonce-unreadable-open                 reference OPEN    his logic allow         (no reason given)  [not in his file: the binding of a transfer to a payment (nonce on the authorization rail, payer on the proof rail) is described in his message and lives in his production code]
  allowed wrong-recipient-large-amount-refuse            reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  DIFFERS underpaid-beyond-safe-integer-refuse           reference REFUSE  his logic allow         (no reason given)  [his file compares amounts as floats and handles USDC with 6 decimals only]
  DIFFERS proof-rail-other-payer-refuse                  reference REFUSE  his logic allow         (no reason given)  [not in his file: the binding of a transfer to a payment (nonce on the authorization rail, payer on the proof rail) is described in his message and lives in his production code]
  allowed wrong-token-refuse                             reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  open    malformed-hash-open                            reference OPEN    his logic deny          (settlement_pending_without_transaction)  [open in this set; his file denies it]
  allowed malformed-hash-not-held                        reference OPEN    his logic deny          (settlement_pending_without_transaction)
  DIFFERS underpaid-18-decimals-refuse                   reference REFUSE  his logic allow         (no reason given)  [his file compares amounts as floats and handles USDC with 6 decimals only]
  open    proof-rail-payer-unreadable-open               reference OPEN    his logic allow         (no reason given)  [not in his file: the binding of a transfer to a payment (nonce on the authorization rail, payer on the proof rail) is described in his message and lives in his production code]
  DIFFERS proof-rail-near-miss-payer-refuse              reference REFUSE  his logic allow         (no reason given)  [not in his file: the binding of a transfer to a payment (nonce on the authorization rail, payer on the proof rail) is described in his message and lives in his production code]
  allowed wrong-token-near-miss-proof-rail-refuse        reference REFUSE  his logic indeterminate (no_matching_usdc_transfer)
  allowed short-hash-not-held                            reference OPEN    his logic deny          (settlement_pending_without_transaction)
```

In words: of the 36 asserted vectors, 22 get the answer of the reference, 8 get a different answer that the vector explicitly allows (his logic holds where the reference refuses, or refuses where the reference leaves a case open), and 6 get a delivery that the vector does not allow. All 6 are about something his file does not contain: the binding of a transfer to a payment (4 vectors) and amounts above what a float holds exactly (2 vectors, which his USDC-only code never meets). Of the 5 open vectors, nothing is asserted; his logic denies three of them and delivers two that need a binding his file does not have.

## Where the two answers differ

On 19 of the 41 vectors the answer of his logic is not the answer of the reference:

- 8 are a different answer that the vector allows. For a wrong recipient, a wrong token, an amount that is too small and a missing transfer, his logic holds (indeterminate) where the reference refuses, and for the two vectors about a string that is not a hash his logic refuses where the reference leaves the case open. Neither holding nor refusing delivers, and the specification does not decide between them, so the vectors allow both.
- 5 are open vectors, where nothing is asserted: his logic denies a pending response without a hash, a malformed hash and a reverted transaction at any depth, and delivers when a nonce or a payer cannot be read.
- 6 are outside what the vector allows: his file delivers. They are the transfers that belong to another payment (two on the authorization rail, two on the proof rail) and the two amounts that a float cannot tell apart.

A transfer that belongs to another payment is not in the class where his logic holds: his gist delivers there, because it has no binding. The vectors for that class allow a hold only because the specification does not decide between refusing and holding. Nothing measured here shows a seller that holds on such a transfer.

## What this does not show

- Not a verification of his production code. The binding by nonce, the binding by payer and the one-hash-one-delivery claim are described in his message and tested here only where his gist has them (the claim, through his EffectStore).
- Not independent: the adapter, the vectors and this README were written by the same party, and he has not seen the adapter.
- One run, one date, one version of the gist file (the hash above).
