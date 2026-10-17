# x402 conformance, edition 1

Measured on 2026-10-17. Unit, ladder and method: [CONFORMANCE.md](../../CONFORMANCE.md).

Everything below is reproducible with two commands and no account:

```
node src/x402-discovery-census.mjs editions/2026-10-17/census-payai.json
node src/x402-index-liveness.mjs editions/2026-10-17/census-payai.json 50 editions/2026-10-17/liveness-payai.json
```

The raw results are in this folder, as three files:

- `census-payai.json`, the complete declared layer, all 1,127 hosts.
- `liveness-payai.json`, the live sample of 50 hosts. This run exposed two defects
  in our own method, so it is kept exactly as it was rather than quietly replaced,
  with a note at the top saying its numbers are superseded.
- `liveness-payai-na-ladderwijziging.json`, the corrected measurement of the two
  hosts the ladder change can affect. The change widened level 2 only, and level 2
  is only evaluated for hosts that reached level 1. Exactly two did.
- `liveness-payai-na-invoerfix.json`, the corrected measurement of the two hosts we
  had asked wrongly. Both answer x402 once asked properly.

In both corrections only the affected hosts were re-measured. The other 48 cannot
change outcome from either fix, so they did not receive a second request.

## What is counted, and what is not

Two different claims get measured separately here, because they turn out to
disagree, and a single number would hide that:

- **Declared**: what parties registered in one discovery index. Cheap and complete,
  so this is a census of all 1,127 hosts.
- **Live**: what an endpoint actually answers today. Costs a request to someone
  else's server, so this is a sample of 50 hosts.

The frame is `facilitator.payai.network/discovery/resources`, read on 2026-10-17.
One index, one day. This is not a measurement of x402 as a whole, and no number
here should be quoted as one.

Index positions move. Re-reading the index a few hours later returned 20,601 records
instead of 20,597, and a resource that had been at position 169 was at 193. The
sample rule is therefore reproducible against the saved `census-payai.json`
snapshot, which is why that file is in this folder, and not against a live re-query
by position.

## The declared layer: one party is half the index

| | |
|---|---|
| records in the index | 20,597 |
| distinct resource URLs | 20,538 (59 records repeat a URL) |
| hosts | 1,127 |
| hosts that registered exactly one resource | 598, which is 53.1% of hosts and 2.9% of resources |
| largest single host | 1,583 resources |

Grouped by registrable domain, 510 domains remain, and the distribution is the
finding:

| resources | hosts | domain | share of the index |
|---|---|---|---|
| 10,634 | 11 | rallylive.ca | 51.8% |
| 1,010 | 2 | delx.ai | 4.9% |
| 932 | 179 | workers.dev | 4.5% |
| 673 | 1 | saylorinnovations.com | 3.3% |
| 594 | 1 | agent402.tools | 2.9% |

One party holds 51.8% of the index across eleven subdomains, each carrying between
65 and 1,583 registrations. The three largest domains hold 61.2% together.

This is why the unit in CONFORMANCE.md is the operator and not the resource. Anyone
quoting the size of this index as a count of resources is quoting one party for more
than half of it. Count per operator and the same index reads as about a thousand
parties, most of them with a single endpoint.

Two limits on that domain grouping, in both directions, because it cuts both ways:

- Subdomains of one company count as separate hosts. That inflates the host count.
  The eleven rallylive.ca subdomains are the clearest case.
- Shared hosting platforms do the opposite: 415 of 1,127 hosts (36.8%) sit on a
  shared subdomain (workers.dev 179, vercel.app 125, railway.app 62, onrender.com
  28, fly.dev 10, netlify.app 7, replit.app 4). Those hosts are mostly different
  parties even though they share a domain, so grouping by domain merges parties
  that have nothing to do with each other.

Neither is solved here. Host is the unit; the domain table is a second view with
its edges named.

Networks, counted per host: `eip155:8453` 704, `base` 197, Solana mainnet 170,
`eip155:84532` 75, then a long tail. The same chain appears under both a CAIP-2
identifier and a bare name, which is worth knowing before anyone sums those rows.

Extensions, counted per host: `bazaar` on 679 hosts. That is the only extension
anyone declares in this index. `offer-receipt` appears on zero of 1,127.

## The live layer: the index does not carry what endpoints serve

Fifty hosts, picked by a rule that is written down so the sample can be checked:
per host the resource with the lowest index position, hosts sorted by that position,
then every nth so the sample spans the whole registration order rather than the
first few parties that registered in bulk. Each host gets exactly one request,
using the method it declares in the index.

Before the sample, two controls, because a sweep where everything fails does not
prove the world is broken, it can equally prove the instrument is:

- positive: a known level 2 endpoint, measured at level 2.
- negative: a plain page that does no x402, measured as not reaching level 0.

Both behaved as expected, so the numbers below are about the endpoints.

| result | hosts | |
|---|---|---|
| answers x402 at level 0 or higher | 33 | 66.0% |
| 404 or 410, the path is gone | 7 | 14.0% |
| not reachable at all | 5 | 10.0% |
| 405, method not allowed | 3 | 6.0% |
| 429, rate limited | 1 | 2.0% |
| 401, behind authentication | 1 | 2.0% |

That 33 includes two hosts that first came back as 400 and turned out to be our own
fault rather than theirs. One is a route whose declared `bodyFields` require real
parameters and we sent an empty body. The other is a template URL,
`https://api.apibooth.com/v1/ip/:ip`, which we requested literally with the colon
still in it while the index supplied the value (`8.8.8.8`) right next to it. Asked
the way the index describes them, both answer 402 correctly.

Anyone repeating this measurement should know how wide that second trap is: 41 of
the 1,127 hosts (3.6%) have a template parameter in the resource this method picks.
One of them landed in our 50. A sweep that ignores this reports those hosts as
refusing requests when they are answering a question nobody asked them.

The three 405s are also about our request: all three are hosts that declare no
method in the index, where we therefore sent POST. That is our default meeting a
GET-only route, not evidence about their x402 support.

Split by whether the index carries a method, the gap is itself a result: of the 30
hosts that declare one, 25 answer x402 (83.3%). Of the 20 that declare nothing, 8 do
(40.0%).

**One of the live x402 hosts declares the offer-receipt extension on every
observation, and a second declares it intermittently. The census found zero.** The
index does not record extensions faithfully, so anyone measuring extension adoption
from a discovery index reads zero while live endpoints serve it. That includes our
own earlier reading, which was wrong for exactly this reason.

The reliable one carries the finding on its own, which matters: the intermittent one
is not load bearing here.

## The one that declares it reliably, and the one that does not

`agents.daedalusdevelopmentgroup.com` reaches **level 2**. It signs its offer in
`jws` with an EdDSA signature and a `did:web` key, and the signature verifies
against the key in its own did document. The payload carries exactly the offer
fields the spec names. This is a real second implementation, with 280 registrations
in the index, and none of them declare the extension.

One defect worth passing on, because it is a single field. Its JWS `kid` points at
`#keys-1`, a `Multikey` whose `publicKeyMultibase` decodes to 32 raw bytes with no
multicodec prefix. did-core requires the `0xed01` ed25519-pub prefix there, which
renders as `z6Mk...`; theirs renders as `zAFr...`. The signature underneath is
correct, so this is encoding only, but a verifier that follows the specification
rejects the key before it ever reaches the signature. The same document already
carries a correct `publicKeyJwk` one entry below, so the fix is to add the prefix or
to point the `kid` at the JWK entry.

`markdown-x402.nordman-tehau.workers.dev` reaches **level 1**, and its level 2 is
**not measured** rather than failed: it signs with `alg: ES256`, which this checker
does not implement. Not supported and not valid are different answers and only one
of them is about the operator.

That host also answered inconsistently. Nine observations over about twenty minutes,
all with the same method and the same empty body: three carried a signed offer and
six carried no extensions at all, alternating rather than switching once. A single
redeployment would show one change in one direction, so that is not what this is. A
buyer cannot rely on receiving the offer.

## What this edition got wrong before it was published

Two defects, both ours, both found while checking rather than after publishing.

The ladder's level 2 required an `eip712` artifact. That scored
`agents.daedalusdevelopmentgroup.com` as failing while its signature was valid in a
form the ladder simply did not know. Published as it stood, the first person to
check would have found it.

The measurement also asked two hosts the wrong question and counted their answers
as results: an empty body where the index declares required fields, and a template
URL requested with its placeholder intact. Both now use what the index itself
declares, and both hosts turn out to answer x402 correctly. A measurement that
cannot tell its own bad request from someone else's bad endpoint is not measuring
the endpoint.

The unit was widened the same day, dated, with the old wording kept readable; see
the change note in CONFORMANCE.md. The level 2 requirement now asks for a signed
offer whose signature verifies in either form, and names the algorithms it cannot
check. The repository also now distinguishes a check that could not run from a check
that failed, which it previously claimed to do in a comment and did not do in code.

Our prior reading that no live seller implements the extension came from measuring
the index rather than the endpoints. It was wrong. Three live implementations turned
up in a sample of fifty hosts: one that signs in jws and verifies on every
observation, one that signs in ES256 and serves the offer on three observations out
of nine, and our own, which signs in eip712 and was not in the sample. Fifty of
1,127 hosts were looked at, so three is a floor and not a count.

## What is not measured here, on purpose

Levels 3 to 5 need a real settlement. They are reported as not measured, never as
absent. Nothing here was paid for, nothing was fuzzed, no endpoint received more
than one request in the sample, and every request carried a user agent that names
this project so any operator can see in their own log who it was.

Fifty of 1,127 hosts were sampled, so the live percentages are an estimate from a
sample and not a census. The census numbers are complete for this one index on this
one day, and nothing more than that.
