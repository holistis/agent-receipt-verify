# Worked example: two calls, one tool, and what binds each result to its own claim

Requested by [epistemedeus](https://github.com/epistemedeus) on
[x402-foundation/x402 pull request 3776](https://github.com/x402-foundation/x402/pull/3776#issuecomment-6739879028):
"the useful case is two calls to the same tool with different arguments at the same price:
what binds each result to its own claim, and what does a mismatched result do?"

This runs that scenario against the real, unmodified source of
[`tokenizen/packages/capacity-attest`](https://github.com/holistis/tokenizen/tree/ce70b898/packages/capacity-attest)
(pinned at commit `ce70b898`), the downstream consumer the other README in this directory
names as a real instance of the `@x402/mcp` fixed-resource-URL pattern. Nothing here is
mocked except the ledger's storage directory, pointed at a disposable temp path
(`CAPACITY_ATTEST_DATA_DIR`) instead of production data.

## The claim has no price field, which is the first answer

`record_delivery`'s fee is flat and set at the tool-config level, not derived from the call's
arguments (see `http-server.ts`). The signed claim's own content fields (`sellerAddress`,
`buyerAddress`, `assetType`, `promisedSpec`, `delivered`, `evidenceHash`, `settlementRef`,
`timestamp`, optionally `priorClaimId`) carry no amount at all. "Same price, different
arguments" is therefore not a special case the code has to handle; every call is the same
price, by construction.

## Two real calls, two real claim IDs

```
claimA.claimId: 0x5aa69f282b9bb5cb0c08396ab25d95e84776ad5cad3382c4a1a43d38f650f1d9
claimB.claimId: 0xbe612bc901c657d82381ed094179c4a9d6ac76a27975ed5c176ea0af3f9841cd
claimIds differ: true
```

`claimId` is `computeClaimId()` (schema.ts, line 752): a SHA-256 of the canonical JSON of the
claim's own content fields. Two calls with different `promisedSpec`/`evidenceHash`/`timestamp`
hash to different digests by construction. Nothing about this computation touches
`resource.url`, the facilitator's `/verify` or `/settle` response, or anything the facilitator
observed. The binding this question asks about already lives entirely inside the claim's own
signed bytes, before `onAfterSettlement` is ever reached.

Both record correctly:

```
record(A): { ok: true, claimId: '0x5aa6...f1d9' }
record(B): { ok: true, claimId: '0xbe61...41cd' }
```

## Four ways to try to produce a mismatch, and what happens to each

`recordDelivery()` (tools.ts, line 25) runs `verifyClaim()` (signing.ts, line 48) before
anything is written. Each attempt below is a real call through that path, against the
disposable ledger, not a description of what should happen.

1. **Graft claim B's content onto claim A's `claimId` and signature.**
   `{ ok: false, reason: 'signature_invalid: claimId_mismatch' }`
   The recomputed hash of B's content never equals A's stored `claimId`, caught before the
   signature is even checked.

2. **Graft claim A's content onto claim B's `claimId` and signature.**
   Same result, same reason, the other direction.

3. **Forge new content, attach claim A's signature to it.**
   `{ ok: false, reason: 'signature_invalid: signature_does_not_match_buyer' }`
   Here the forged content's own recomputed `claimId` *could* match what's attached, so the
   first check passes; the signature itself was produced over a different `claimId` entirely,
   and `ethers.verifyMessage` recovers an address that was never going to equal `buyerAddress`
   for content it never signed.

4. **Replay claim A, byte for byte, a second time.**
   `{ ok: false, reason: 'claim_already_recorded: 0x5aa6...f1d9' }`
   A different mechanism from the three above: the ledger's own claimId lock (`ledger.ts`),
   independently benchmarked at 0% duplicates under real multi-process contention. Not a
   content or signature failure. An exact duplicate is rejected for being exactly that.

`verifyClaim()` alone, without touching the ledger at all, independently reaches the same
verdict for attempts 1 to 3, which is why the rejection in `recordDelivery()` is not a side
effect of the ledger, but the claim itself failing to verify.

## What this does and does not show

- It shows the three concrete mechanisms (content-hash recomputation, signature recovery, and
  a separate duplicate-claimId lock) that would each, independently, have to fail for a
  mismatch to land, and that a direct attempt to produce one is rejected by each in turn.
- It does not run two settlements concurrently through a live `@x402/mcp` server; the earlier
  proof in this repository's companion notes established, by reading `@x402/mcp` 2.30.0's
  source, that `createPaymentWrapper`/`processPaidToolCall`/`onAfterSettlement` pass arguments
  as function parameters with no shared mutable state between calls, which is why there is no
  live interleaving scenario to construct here beyond what is shown above. That absence of a
  shared-state path, not this script, is the reason no fifth "concurrent calls swap results"
  attempt appears.
- It does not speak to any other `@x402/mcp` integration; this is specific to capacity-attest's
  own claim schema and ledger, not a general property of the SDK.

## How to run

From `tokenizen/packages/capacity-attest`, with that package's own dependencies installed:
point `CAPACITY_ATTEST_DATA_DIR` at a throwaway directory and run a script that imports
`recordDelivery` from `src/tools.ts`, `verifyClaim` from `src/signing.ts`, and
`buildSignedClaim`/`testWallet` from `src/test-helpers.ts`, exactly as shown above. No network
call, no real money, no production ledger touched.

## Credit and scope

The question this answers is epistemedeus's. The underlying facilitator-request-binding
observation this worked example responds to is also his, documented in the companion README
in this directory.

## Cite

Ouadoudi, A. (holistis). Worked example: claim binding under the facilitator-request-binding gap. agent-receipt-verify, 2026.
https://github.com/holistis/agent-receipt-verify/tree/main/vectors/facilitator-request-binding/worked-example-capacity-attest.md

Licensed under Apache-2.0, see `LICENSE` and `NOTICE` at the root.
