# agent-receipt-verify

Independent verification of payment- and outcome-proof receipts used by AI agents.

## Run it, one line

```
npx -y agent-receipt-verify https://api.bitrefill.com/x402/gift-cards/search
```

No account, no key, no payment. It tells you whether that endpoint asks for money the
way x402 says, and says NOT MEASURED for the levels that need a real settlement instead
of failing them.

What it does NOT do: it judges the SHAPE of a receipt, not the honesty of the party that
issued it. See CONFORMANCE.md for what is deliberately left unmeasured.

```
npx -y agent-receipt-verify attempt-identity   # 19 vectors for x402 spec section 5.5
npx -y agent-receipt-verify link-vectors       # 12 vectors, receipt to settlement
npx -y agent-receipt-verify kanon              # cross-check against iamonuwa/kanon
```

## What this is

An agent economy has two kinds of receipt. One says who was allowed to act
(delegation: UCAN, Authproof, Agent Passport). The other says what was paid for
and whether the output matches (settlement and outcome: x402 offer-receipt, INAM
countersigned receipts, and the proofs ERC-8004 consumers count).

`receipt-commons/receipt-interop` covers the first kind. This covers the second.

## Use it from an agent: the MCP server

Both checks are also a Model Context Protocol server, so an agent can run them itself
instead of a person running a command. It speaks MCP over stdio, protocol version
2025-11-25. The framing, `initialize`, `tools/list` and `tools/call` are implemented
directly in `src/mcp-server.mjs`, with no MCP SDK and no required dependency at all.

Two tools, for the two moments where an agent actually needs an answer.

`check_x402_endpoint`, before paying. Sends one request and reports which levels of the
ladder in [CONFORMANCE.md](CONFORMANCE.md) the endpoint reaches. Levels that need a real
settlement come back as not measured, never as failed.

`link_receipt_to_settlement`, after paying. Takes the receipt, the authorization salt and
the asset that was paid, resolves the salted commitment against live chain state, and
answers linked, not linked, or could not check. Those are three different answers and it
never collapses them into two.

Add it to a client:

```json
{
  "mcpServers": {
    "agent-receipt-verify": {
      "command": "npx",
      "args": ["-y", "github:holistis/agent-receipt-verify", "mcp"]
    }
  }
}
```

No account, no API key, nothing published to npm. If you would rather not run Node from a
git ref, there is a Dockerfile:

```sh
docker build -t agent-receipt-verify . && docker run -i --rm agent-receipt-verify
```

The server opens no port and writes nothing to disk. Anything that is not a protocol
frame goes to stderr, because stdout belongs to the client. `npm test` drives the server
over real frames in 21 cases, including an unknown tool name, a notification that must
not get a reply, and a network it does not know, which has to answer could not check
rather than not linked.

`ethers` is an optional dependency, used for one signature check inside
`check_x402_endpoint`. Without it that single check reports not measured instead of
passing, and everything else works unchanged.

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
| x402 offer-receipt (commitment §5.6, proposed in PR 3827) | x402-foundation/x402 @ 0e492d6, not on main | 1 published example plus 6 own edge cases | yes, byte-identical |
| x402 settlement link (§5.6.4, same proposal) | own tests plus three live settlements | 22 offline, 3 live | yes, each resolves to its own settlement |

```sh
npm test      # all of the above. No account, no key, and nobody else's server
```

Node built-ins only, apart from keccak256. Two honest footnotes, because "no network"
was not quite true and is the kind of claim this package should not make loosely:

- One case dials a closed port on localhost on purpose, to prove that a dead address
  reports not-measured instead of crashing the tool. That is a socket, but it leaves
  the machine alone and reaches no third party.
- Until recently the suite also fetched a live discovery index belonging to someone
  else, roughly twenty thousand entries, because one test handed an unknown flag to
  `census` and `census` ignored unknown flags and went to work. That flag is now
  refused, so the suite finishes in about eleven seconds and contacts nobody. A single
  index round alone used to take over thirty.

Only the settlement link below reaches a real network, and then only a public,
read-only RPC.

Confirmed from the other side, which matters more than the table: the author of
the x402 specification ran their own implementation, which shares no code with
this one, against all three live receipts below and reached the same three
settlements, starting from the receipt, the salt and the asset as §5.6.4
requires. Their result and ours are in
[x402#3827](https://github.com/x402-foundation/x402/pull/3827#issuecomment-6230063003).

## Recompute it yourself, without an account

Two of the cross-checks run offline from a single command, so nothing here has to be
taken on trust:

```sh
npx -y agent-receipt-verify kanon
npx -y agent-receipt-verify beleid
npx -y agent-receipt-verify link-vectors
```

The first checks our EIP-3009 verifier against the ten published vectors of
iamonuwa/kanon. The second exists because agreement can hide a question: all ten of
those vectors cover underpayment only, so they say nothing about overpayment, or
about one nonce reused across two payers. Those are the two open questions in
[x402#2725](https://github.com/x402-foundation/x402/issues/2725), and the command
prints exactly where the two possible answers diverge and where they do not.

The third runs twelve vectors for the half AFTER paying: does this receipt belong to
that one settlement. Eleven of them need no network at all; the twelfth reads the chain
and is marked and skipped rather than reported as a failure, because a check that could
not run says nothing about the receipt. The same twelve also exist in the field layout
of the Kanon vectors, in `vectors/settlement-link-kanon`, so the two corpora can sit
side by side.

Two more commands, both of which measure other people's endpoints rather than our own,
and both read-only:

```sh
npx -y agent-receipt-verify census [out.json]
npx -y agent-receipt-verify liveness [out.json]
```

`census` counts a discovery index per HOST rather than per resource, so a party with
three hundred paths does not outweigh three hundred parties with one. `liveness` takes
that census and asks each host whether it still answers 402 today, because a
registration in an index is not a promise that the endpoint is alive. Both are slow by
design: they pause between requests, because the hosts in that list did not ask to be
measured.

## Linking a receipt to its settlement

A receipt with an empty `transaction` field can be matched to a payment only by
payer, payee, amount and time. Two payments with the same terms in the same block
cannot be told apart at all. Section 5.6 of the x402 offer-receipt extension fixes
that with a salted commitment to the ERC-3009 nonce: whoever holds the salt can
recompute the link to exactly one settlement, and everyone else learns nothing.

Where section 5.6 lives, because it is not where a reader would assume. Sections 5.6
through 5.6.5 do not exist in the version of the offer-receipt extension on `main`.
They exist only in pull request 3827, which is open. Everything here that cites 5.6 is
therefore measured against a proposal, pinned to commit `0e492d6` on that pull request,
which is four commits ahead of `main` and fetchable by anyone. The numbering can still
move before it merges. Levels 4 and 5 of the ladder carry this in the profile, and the
tool says so in its own output, so a result is never quietly presented as measured
against published text.

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

The format checks test the form of a receipt: signatures, content addressing,
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

The ladder itself is a versioned file, [profiles/x402-deployed-ladder-v1.json](profiles/x402-deployed-ladder-v1.json),
which names the clause behind every level, the input each check needs, and what to
report when a check cannot decide. The tool reads that file rather than carrying the
rules in code, so a second implementation can measure the same thing without reading
ours.

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
