# x402 conformance, edition 2

Measured on 2026-11-20. Unit, ladder and method: [CONFORMANCE.md](../../CONFORMANCE.md). Edition 1 is [here](../2026-10-17/EDITION-1.md).

Cite as: github.com/holistis/agent-receipt-verify, editions/2026-11-20, 2026-11-20.

The frame is the same as in edition 1: `facilitator.payai.network/discovery/resources`, one index, one day. This is not a measurement of x402 as a whole, and no number below should be quoted as one. The text names no operator; the raw files list hosts because the index does.

## What is different from edition 1

Edition 1 measured a sample of 50 hosts. This edition sends one request to every host the index lists, 1,703 of them, so the live layer is a count and not an estimate. The same measurement was run twice, overlapping in time (21:11 to 22:38 UTC and 21:58 to 22:47 UTC), so the repeatability is a number too: the two measurements of one host are at most about 90 minutes apart.

## Recount it

```
node src/x402-discovery-census.mjs editions/2026-11-20/census-payai.json
node src/x402-index-liveness.mjs editions/2026-11-20/census-payai.json 1703 editions/2026-11-20/liveness-run-a.json
node src/x402-edition-summary.mjs editions/2026-11-20/census-payai.json editions/2026-11-20/liveness-run-a.json editions/2026-11-20/editie1-gecorrigeerd.json
```

The second command wrote `liveness-payai-volledig.json`, kept here as `liveness-run-a.json`. The raw files are in this folder with their hashes in `SHA256SUMS.txt`. `liveness-run-b.json` is the second run (written by `run-liveness.mjs`, which does the same measurement with a checkpoint after every 20 hosts). `editie1-gecorrigeerd.json` is the 50 hosts of edition 1 with the two correction files laid over the base, as EDITION-1.md describes (33 of 50 answer x402, as there). The summary tool is tested with a planted fault for every check it makes (`test/edition-summary.mjs`).

The numbers below are the output of the third command, pasted unchanged. A test (`test/edition-2-numbers.mjs`) runs the tool again and fails if this block differs.

<!-- summary:start -->
```
Declared layer: 17737 records, 17611 distinct resource URLs, 1703 hosts.
  919 hosts (54.0%) registered exactly one resource. The largest single host holds 1687 records (9.5%).
  2 of 1703 hosts declare the offer-receipt extension in the index.
Live layer: 1703 hosts measured once each, 1703 on a usable request, 0 not measurable (a template URL we could not fill in).
  1324 of 1703 (77.7%) answer the way x402 says, level 0 or higher. 23 declare the offer-receipt extension live.
     1324   77.7%  x402_ok
      179   10.5%  pad_weg
       48    2.8%  status_402_onbruikbaar
       46    2.7%  geen_betaalmuur
       34    2.0%  verzoek_geweigerd
       30    1.8%  afgeschermd
       19    1.1%  serverfout
       11    0.6%  onbereikbaar
       10    0.6%  methode_geweigerd
        2    0.1%  tempo_geweigerd
  hosts that declare a method in the index: 1158 of 1326 answer (87.3%); that declare none: 166 of 377 (44.0%)
Earlier edition: 50 hosts measured then, 38 still in the index, 12 gone from it. {"antwoordde -> antwoordt":24,"antwoordde -> antwoordt niet":3,"antwoordde niet -> antwoordt niet":6,"antwoordde niet -> antwoordt":5}
Checks passed: every census host measured exactly once, controls passed, every bucket known.
```
<!-- summary:end -->

## What the numbers say

- **The index lost records and gained hosts.** Edition 1 read 20,597 records from 1,127 hosts. This edition read 17,737 records from 1,703 hosts: 13.9 percent fewer records, 51.1 percent more hosts. Index positions are therefore not comparable between the two editions.
- **1,324 of 1,703 hosts (77.7 percent) answer the way x402 says** on the resource we asked, at level 0 or higher. The 50-host sample of edition 1 gave 66.0 percent (33 of 50); its 95 percent Wilson interval is 52.2 to 77.6 percent, so the full count sits at the upper edge of what that sample allowed.
- **The other 379 hosts split like this:** 179 answer 404 or 410 (the path is gone), 48 answer 402 but with nothing a client could act on, 46 answer without any payment demand, 34 refuse our request, 30 are behind authentication, 19 return a server error, 11 are not reachable, 10 refuse the method, 2 rate-limit us.
- **The index does not record extensions faithfully.** It carries the offer-receipt extension for 2 hosts. Live, 23 hosts declare it (8 at level 1, 15 at level 2, where the signed offer verifies). The 15 level-2 hosts sit on 14 registrable domains (two share vercel.app). One of them is our own `api.tokenizen.nl`, which is also the positive control of the run. A second host of ours, `x402-mcp.tokenizen.nl`, is among the 1,703 and counts as "refuses the method", because we sent POST. We took our own route as the positive control because we know its answer; a third-party level-2 host would have been the better control, and we have none whose answer we know in advance. Edition 1 saw the same shape: the census found zero while live endpoints served it.
- **Declaring a method matters, and it is our request.** Of the 1,326 hosts that declare a method in the index, 87.3 percent answer; of the 377 that declare none, 44.0 percent do. Where nothing is declared we send POST, and a GET-only route then answers 405 or 404. Read that gap as a property of the instrument, not of those hosts.

## Four checks on our own measurement

1. **Does the first resource mislead?** We ask one resource per host, the one with the lowest index position, which is usually the oldest registration and so the most likely to be gone. For the 179 hosts whose first resource is gone we measured the newest registration as well. 113 of the 179 have only one resource URL (the same URL can be registered more than once: 17,737 records, 17,611 distinct URLs). Of the 66 that have another resource URL, 4 answer x402 on the newest one (6 percent). That is a floor: only the newest other path was measured, the rest were not, so at least 4 of the 179 are alive on another path. The index was read again for this check, a few hours after the census, so the newest path comes from a slightly later index. Files: `tweede-resource.mjs`, `tweede-resource.json`.
2. **Is the measurement repeatable?** Run A and run B agree on the bucket for 1,693 of 1,703 hosts (99.4 percent) and on the yes or no of "answers x402" for 1,696 (99.6 percent). The ten that differ: two answered in one run and returned a server error in the other, and two the reverse; two went from no payment demand to a server error and one from no payment demand to answering; one went from behind authentication to unreachable, one from unreachable to answering, one from a gone path to answering. Run A counts 1,324 answering hosts, run B 1,327.
3. **Is the unit the host, and who fills the hosts?** The 1,703 hosts sit on 655 registrable domains (the last two labels of the host name). The largest, `workers.dev`, a free hosting platform, holds 446 hosts (26.2 percent) and 398 of them answer; `vercel.app` holds 157 hosts and 72 answer. Leaving out the free-platform domains (workers.dev, vercel.app, onrender.com, railway.app, netlify.app, pages.dev, fly.dev, replit.app), 769 of 963 hosts answer (79.9 percent). The headline moves by two points; the mix underneath moves more, and a host is not an operator.
4. **Did the instrument work?** Before each run the positive control (our own paid route, known to reach level 2) measured level 2 and the negative control (a plain page) measured as not reaching level 0. A run where either failed would have been discarded.

## What we do not claim

- Not that 22.3 percent of x402 endpoints are dead. It is 379 of the 1,703 hosts that this one index lists, each asked once, on one resource, on one evening (21:11 to 22:47 UTC).
- Not that every non-answer is the host's doing. Each host got one attempt with a 15-second timeout and one fixed User-Agent (`x402-conformance-check/1 (read-only, github.com/holistis/agent-receipt-verify)`), no retry: a slow cold start counts as unreachable or as a server error, and bot protection can look like a refusal. The two runs agreeing for 99.4 percent of the hosts says these cases are rare in this data, not that they are absent.
- Not uptime. One request per host says nothing about the hours around it, and a host that answered in run A and not in run B (or the other way round) is in the numbers of both.
- Not levels 3 to 5. They cannot be seen without paying, so they are not measured.
- Not anything about who the hosts are.
- One of the 15 level-2 hosts is ours. We measured our own host with the same request as the others.

## Files

`census-payai.json` (the declared layer), `liveness-run-a.json` and `liveness-run-b.json` (the live layer, twice), `tweede-resource.json` (check 1), `editie1-gecorrigeerd.json` (the cohort of edition 1), `run-liveness.mjs` and `tweede-resource.mjs` (how runs B and the second resource were made), `SHA256SUMS.txt`.
