# A runnable NEG-3 collapse

What this shows: two valid x402-style requests that differ only in amount, run against
two small servers. `vulnerable-server.mjs` settles both under the same identity.
`fixed-server.mjs` settles them under two different ones. Nothing here talks to a
network, an account, or a key.

```
node run-demo.mjs
```

## Why this is the interesting case

x402 specification section 5.5 (proposed in
[x402-foundation/x402#3776](https://github.com/x402-foundation/x402/pull/3776)) requires
that the artifact correlating `/settle`, refusal handling, and replay-lookup be derived
exactly once, at ingress, from the complete request snapshot, and never re-derived
downstream. The PR's own description calls the hardest violation of this rule NEG-3: all
the paths agree on one value, and that value happens to have been computed, at least
once, from something outside the ingress snapshot. A checker that only compares the
final values across paths reports conformance, because the value came out the same.

`vulnerable-server.mjs` makes exactly that mistake: it records a correct ingress
snapshot, but `settle()`, `refusal()`, and `replayLookup()` each ignore it and
independently recompute their own identity, live, from only `method + path + query`.
Amount never enters that recomputation. A quoted request and an overcharged request to
the same endpoint get different ingress identities (correctly) and the same settle
identity (incorrectly) — the overcharge can settle, or be matched as a replay, as if it
were the original.

This is not invented for effect. `vectors/attempt-identity/changed-amount-silent-
collapse.json` in this repository encodes the identical story as a static fixture, and
`StelarDigital/x402-receipts`'s own code comments record fixing a sibling case (a
query-only identity that ignored the body) as a historical incident, admitted at
[x402-foundation/x402#3325](https://github.com/x402-foundation/x402/issues/3325). This
demo makes that class of mistake runnable instead of only readable.

## Files

- `vulnerable-server.mjs` / `fixed-server.mjs` — the same three-function shape
  (`ingress`, `settle`, `refusal`, `replayLookup`), one re-deriving downstream, one not.
  Both reuse `velddigest` from `../../src/attempt-identity.mjs`, the same function the
  73 vectors in `vectors/attempt-identity/` are checked against — this is not a separate
  mechanism invented for the demo.
- `run-demo.mjs` — runs both servers against a quoted and an overcharged request, prints
  the contrast.
- `../../test/neg3-collapse-demo.mjs` — the automated version: asserts the vulnerable
  server collapses, the fixed server does not, and that `fixed-server.mjs`'s `settle()`
  structurally ignores the request object it is handed (fed a deliberately mismatched
  request, it must still return the ingress identity unchanged). Part of `npm test`.

## What this does not show

This is an illustration of the rule, not a finding against a named, running system. The
three implementations x402-foundation/x402#3776 cites as evidence
(`ruiruii/gates-spec`, `StelarDigital/x402-receipts`, `seancrecord/scvd-general-store-
repo`) were checked separately against the same four negative cases; no confirmed
violation was found in any of them. That result lives in the conformance matrix, not
here.
