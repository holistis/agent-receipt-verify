# agent-receipt-verify

Independent verification of payment- and outcome-proof receipts used by AI agents.

An agent economy has two kinds of receipt. One says **who was allowed to act**
(delegation: UCAN, Authproof, Agent Passport). The other says **what was paid for
and whether the output matches** (settlement and outcome: x402 offer-receipt, INAM
countersigned receipts, and the proofs ERC-8004 consumers count).

`receipt-commons/receipt-interop` covers the first kind. This covers the second.

## Why independent implementations matter

A receipt signed by a seller is a statement by an interested party. It only becomes
evidence when someone who was not the signer can recompute it and reach the same
conclusion. So every verifier here is written against the published specification,
never against the reference implementation's source, and is tested against the
vector files published by the protocol's own authors.

If two implementations that have not seen each other's code agree on the same
vectors, that is interop. One implementation agreeing with itself proves nothing.

## Status

| Format | Vectors by | Cases | Our verdicts match |
|---|---|---|---|
| INAM countersigned | inamprotocol/inam-protocol @ d5e5f45 | 4 | 4 / 4, identical failed-check sets |
| x402 offer-receipt (commitment §5.6) | x402-foundation/x402 @ 0e492d6 | 1 published example plus 6 own edge cases | yes, byte-identical |
| x402 settlement link (§5.6.4, on chain) | own tests plus two live settlements | 20 offline, 2 live | yes, each resolves to its own settlement |

```sh
npm test      # all of the above, no network, no keys
```

Node built-ins only, apart from keccak256. Only the settlement link below touches
the network, and then only a public read-only RPC.

## Linking a receipt to its settlement

A receipt with an empty `transaction` field can be matched to a payment only by
payer, payee, amount and time. Two payments with the same terms in the same block
cannot be told apart at all. Section 5.6 of the x402 offer-receipt extension fixes
that with a salted commitment to the ERC-3009 nonce: whoever holds the salt can
recompute the link to exactly one settlement, and everyone else learns nothing.

Section 5.6.5 is the part that makes this matter in practice. A commitment that
nobody has opened is still only a statement by the signer: they can issue two
receipts with different salts for one settlement, or a commitment that opens to
nothing at all. So a consumer that counts settlements, for a deduplicated or
Sybil-resistant count, may count only the commitments that someone has opened.

Here are two payments with identical terms: same payer, same payee, same amount,
same resource, minutes apart on Base Sepolia. Without a commitment these two
receipts could not be told apart. Each one still resolves to its own settlement:

```sh
npm run link-example
```

```
receipt     : version 2, payer 0x87f344b6Ec48A936373d774D3De8649DEEB66Ee1
commitment  : 0x5c35a61a09a566a9c284fad18a70ac2ddfff34d01d2a3ce776ce94e8d5b38ff8
searched    : blocks 48208971 to 48209643 (4 calls, measured block time 2.00s)
candidates  : 2 nonce(s) consumed by this payer in that window
LINKED      : yes, to exactly one settlement
  nonce     : 0x1120412c78ea1b2e8bf9eacfc3264c71a23ecd9b1fa579eb16030693344d5dfe
  tx        : 0xed87b09bfb20a8c8b69908e163fcea6432d193d389640c0465afcb5561dfeb30

receipt     : version 2, payer 0x87f344b6Ec48A936373d774D3De8649DEEB66Ee1
commitment  : 0xfecee93e1aec7d6858a218bf324f23e2a4eed07925d8d4542b9662c5026e3d22
searched    : blocks 48209215 to 48209643 (3 calls, measured block time 2.00s)
candidates  : 2 nonce(s) consumed by this payer in that window
LINKED      : yes, to exactly one settlement
  nonce     : 0x515895dfac6f148a4cfdf5c4f8266b7859dbd6534cdf77104b1be9f484eb5005
  tx        : 0x2898d0ceb97ddf60af98e19c94fc0adddbdf1e64f9032e62454085e37acfe36b
```

Both runs see the same two candidate nonces on chain. Each receipt's commitment
picks out one of them, and a different one. That is the ambiguity section 5.6.1
describes, resolved against live state.

The upper block number will not match the output above exactly when you run it:
the window is capped at the current chain head until the head passes it. The
verdict and the transaction hashes do not move.

The two files in `examples/` hold exactly what section 5.6.4 says a later verifier
has: the receipt, its salt, and the asset that was paid. The nonces and the
transaction hashes are deliberately kept out of them. Those come out of
`AuthorizationUsed(address,bytes32)` logs on the token contract, and the tool
accepts an answer only when exactly one candidate opens the commitment. Zero
matches and two matches are both reported as not linked, never as a best guess.

Point it at your own receipt with `--receipt=<file>`, and add `--salt=` and
`--asset=` if they are not stored alongside it. All three are required: a receipt
and a salt without the asset cannot link, which is section 5.6.4's own warning.

Those two payments went to a live x402 seller that issues version 2 receipts.
Buyer and seller are both us, so this shows the chain closes end to end. It does
not show that anyone else is using it.

## Honest limits

The format checks test the **form** of a receipt: signatures, content addressing,
and whether the hashes match the bytes a counterparty observed. They do not tell
you whether an operator is honest, or whether a registry holds a receipt as
finalized.

The settlement link does read live chain state, and these are its real edges:

- It searches a window around the receipt's `issuedAt`, not the whole chain,
  because the public Base Sepolia RPC caps `eth_getLogs` at 200 blocks per call
  (measured, not read in documentation). The window it searched is always printed,
  so "not found" reads as "not in this window" and never as "does not exist".
  Widen it with `--window=`.
- A refused RPC call raises an error instead of returning an empty result. A search
  that could not run must never be reported as a search that found nothing.
- Only `eip3009` is implemented, because that is the only method the specification
  currently defines.
- It confirms that a receipt commits to one settlement. It does not confirm that
  the amount or the payee were the agreed ones; read the matching transaction for
  that.
- Receipt version 2 is defined in a pull request that is still open, so its
  preimage can still change. The commit it was built against is pinned in the
  source and in the status table above.

## Provenance and license

Apache-2.0, the same licence both verified projects use. Their published test material is
redistributed unmodified with attribution; see NOTICE for the exact commits. Neither
project has reviewed or endorsed this repository.
