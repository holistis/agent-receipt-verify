# Facilitator request-binding vectors

Seven vectors, modeling the published `@x402/core`, `@x402/express` and `@x402/mcp` version
2.30.0 source (fetched via `npm pack @x402/core@2.30.0 @x402/express@2.30.0 @x402/mcp@2.30.0`
on 9 November 2026, read, not executed), after a contributor named
[epistemedeus](https://github.com/epistemedeus) posted a reproduction on
[x402-foundation/x402 pull request 3776](https://github.com/x402-foundation/x402/pull/3776#issuecomment-6736524227)
showing that a remote facilitator never observes the original query string, body, or HTTP
method of the request it verifies and settles.

## What this is, and what it is not

This is **not** a dupe of `vectors/attempt-identity`. That set tests whether an
implementation's *derivation* of the attempt identity follows section 5.5's text, given a
request snapshot it already has. This set tests something upstream: whether the snapshot a
resource server hands to the facilitator ever contained the properties section 5.5 assumes
are available. We checked, and the two do not overlap: none of the 72 attempt-identity
vectors depend on wire transport, and none of these seven depend on section 5.5's text. They
are kept in a separate module (`src/facilitator-request-binding.mjs`) and a separate test
(`test/facilitator-request-binding.mjs`) so a passing attempt-identity vector can never be
read as a wire-transport guarantee it does not make.

We also checked, and want to state plainly: **the gap this documents is not automatically a
vulnerability.** The resource server, not the facilitator, may be the component responsible
for binding a payment to the specific operation it pays for. Whether that binding exists
anywhere, outside the facilitator's view, is a separate, open question this repository does
not answer.

## What is here

| File | Claim |
| --- | --- |
| `query-collapses-under-configured-resource.json` | collapses |
| `query-distinguished-under-auto-resource.json` | stays distinguished (control case) |
| `body-never-reaches-facilitator-configured.json` | collapses |
| `body-never-reaches-facilitator-auto.json` | collapses |
| `method-never-reaches-facilitator-configured.json` | collapses |
| `method-never-reaches-facilitator-auto.json` | collapses |
| `mcp-tool-name-only-resource-real-world.json` | collapses |

One finding sharper than epistemedeus's framing, found while modeling the exact source: the
query-string gap is *conditional* on whether a route configures a fixed `resource` string
(it is carried inside `req.originalUrl` otherwise). The body and method gaps are **not**
conditional on anything; neither has a field anywhere in the `/verify` or `/settle` request
body, with or without a configured resource. Collapsing all three into one "configured vs.
not" claim would overstate what the source shows for body and method. See the two auto-
resource vectors, which exist specifically to make this visible.

The seventh vector is not hypothetical: `@x402/mcp` builds every paid tool call's
`resource.url` from the tool name alone (`mcp://tool/${toolName}`, line 92), for every
integration, including our own `tokenizen/packages/capacity-attest`.

## How to run

From the root of this repository: `node test/facilitator-request-binding.mjs`. No network, no
account. Deliberately not wired into `npm test` alongside the attempt-identity suite, for the
reason stated above.

## Limits

- This models a pinned version (2.30.0) of three specific packages, read as source, not
  observed as traffic from a running server. If a future version changes this behavior, these
  vectors describe 2.30.0, not whatever comes after it.
- This does not establish whether any downstream consumer (including our own
  capacity-attest) has an independent, out-of-band check that would still catch the mismatch
  this gap permits. That is a separate claim, with its own separate evidence, not inferred
  from these seven vectors.
- This does not demonstrate a successful replay against any live facilitator. Like
  epistemedeus's original reproduction, it is a statement about what the published code
  computes, not an attack carried out against a running service.

## Worked example and prevalence scan

`worked-example-capacity-attest.md` / `.ts`: a concrete answer to epistemedeus's follow-up
question (two calls to the same tool, different arguments, same price: what binds each
result to its own claim, and what does a mismatched result do), run against the real,
unmodified source of `tokenizen/packages/capacity-attest`.

`prevalence-scan.mjs` / `prevalence-scan-summary.json`: a mechanical, repeatable count of how
often the fixed-resource pattern shows up in real, independent public `@x402/mcp` users
(denominator and method in the script header; aggregate counts only in the summary file,
deliberately without individual repository names, so the script, not our say-so, is the
thing anyone can rerun to check or extend the number).

## Credit

The underlying observation is [epistemedeus](https://github.com/epistemedeus)'s, posted on
x402-foundation/x402#3776. We read the published package source independently to verify it
before building on it, rather than running the submitted reproduction script.

## Cite

Ouadoudi, A. (holistis). Facilitator request-binding vectors for x402 (2.30.0). agent-receipt-verify, 2026.
https://github.com/holistis/agent-receipt-verify/tree/main/vectors/facilitator-request-binding

Licensed under Apache-2.0, see `LICENSE` and `NOTICE` at the root.
