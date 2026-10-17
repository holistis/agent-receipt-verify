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
| x402 settlement link (§5.6.4, on chain) | own tests plus three live settlements | 22 offline, 3 live | yes, each resolves to its own settlement |

```sh
npm test      # all of the above, no network, no keys
```

Node built-ins only, apart from keccak256. Only the settlement link below touches
the network, and then only a public read-only RPC.

Confirmed from the other side, which matters more than the table: the author of
the x402 specification ran their own implementation, which shares no code with
this one, against all three live receipts below and reached the same three
settlements, starting from the receipt, the salt and the asset as §5.6.4
requires. Their result and ours are in
[x402#3827](https://github.com/x402-foundation/x402/pull/3827#issuecomment-6230063003).

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

Here are three payments with identical terms: same payer, same payee, same
amount, same resource, minutes apart on Base Sepolia. Without a commitment those
receipts could not be told apart. Each one still resolves to its own settlement:

```sh
npm run link-example
```

```
commitment  : 0x5c35a61a09a566a9c284fad18a70ac2ddfff34d01d2a3ce776ce94e8d5b38ff8
candidates  : 2 nonce(s) consumed by this payer in that window
LINKED      : yes, to exactly one settlement
  tx        : 0xed87b09bfb20a8c8b69908e163fcea6432d193d389640c0465afcb5561dfeb30

commitment  : 0xfecee93e1aec7d6858a218bf324f23e2a4eed07925d8d4542b9662c5026e3d22
candidates  : 3 nonce(s) consumed by this payer in that window
LINKED      : yes, to exactly one settlement
  tx        : 0x2898d0ceb97ddf60af98e19c94fc0adddbdf1e64f9032e62454085e37acfe36b

commitment  : 0xea8dd34b8beac90f021a4e8d893a689c25249f86947770c8e6647c1cde206008
candidates  : 2 nonce(s) consumed by this payer in that window
LINKED      : yes, to exactly one settlement
  tx        : 0x2a9e95d63a5af8210767baa69143b364dad51caffc29a152c77e03bc508d7199
```

Each window is centred on its own receipt's `issuedAt`, which is why the
candidate counts differ: the middle receipt's window covers all three payments
and it still picks out exactly one. That is the ambiguity section 5.6.1
describes, resolved against live state.

Two things in that output move and the verdict does not. The candidate count
rises as that payer consumes more nonces, and the upper block number is capped
at the current chain head until the head passes it. The transaction each receipt
resolves to is fixed.

The three files in `examples/` hold exactly what section 5.6.4 says a later verifier
has: the receipt, its salt, and the asset that was paid. The nonces and the
transaction hashes are deliberately kept out of them. Those come out of
`AuthorizationUsed(address,bytes32)` logs on the token contract, and the tool
accepts an answer only when exactly one candidate opens the commitment. Zero
matches and more than one match are both reported as not linked, never as a best guess.

Point it at your own receipt with `--receipt=<file>`, and add `--salt=` and
`--asset=` if they are not stored alongside it. All three are required: a receipt
and a salt without the asset cannot link, which is section 5.6.4's own warning.

Those payments went to a live x402 seller that issues version 2 receipts, and it
publishes these cases itself, with the settlement each one should resolve to, at
`https://api.tokenizen.nl/api/x402/conformance`. Point your own implementation at
that and compare, or call its paid route and link a receipt you obtained yourself.
A fixture cannot tell you whether the salt arrives at the location §5.6.3 names,
inside a real settlement envelope; only a paid call can.
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

  A receipt may be signed before its settlement lands, since the seller holds the
  nonce first, so the window is centred rather than backward-looking. What that
  costs, measured against a live receipt, with the reach derived from the measured
  block time:

  | `--window` | reach around `issuedAt` | RPC calls | wall clock |
  |---|---|---|---|
  | 50 | 1.7 min | 1 | 0.7s |
  | 200 | 6.7 min | 3 | 0.8s |
  | 400 (default) | 13 min | 5 | 1.3s |
  | 1000 | 33 min | 11 | 1.7s |
  | 2000 | 67 min | 21 | 2.9s |

  Calls grow linearly with the window and not with the payer's history, which is
  the trade the window buys: an hour of tolerance for 21 requests. Searching a
  payer's full set of consumed nonces instead needs no `issuedAt` at all and
  cannot miss on skew, at a cost that grows with how much that payer has ever
  spent.
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

## Check your own endpoint, in one command

No install, no account, nothing published to npm:

```sh
npx github:holistis/agent-receipt-verify https://your-endpoint.example/paid
```

It measures levels 0 to 2 of the ladder in [CONFORMANCE.md](CONFORMANCE.md) without
paying. Levels 3 to 5 need a real settlement and come back as not measured, never as
failed. What it deliberately does not measure is listed in that same file.

## A badge for an endpoint that was measured

If an edition covered your endpoint, there is a badge for it:

```md
[![x402 receipt](https://api.tokenizen.nl/api/x402/badge?url=https%3A%2F%2Fyour-endpoint.example%2Fpaid)](https://github.com/holistis/agent-receipt-verify/blob/main/CONFORMANCE.md)
```

The same data as JSON is at `/api/x402/badge.json?url=...`.

Two things about that badge, because both are deliberate. It never measures live: it
answers from a dated measurement, so nobody can use that endpoint to probe arbitrary
hosts, and the number does not change on every hiccup. And the measurement date is
rendered inside the badge, so a badge that has gone stale is visibly old rather than
quietly wrong.

An endpoint no edition has covered comes back as `measured: false`, not as level 0.
Those are different claims: one says we looked and found nothing, the other says we
never looked.
