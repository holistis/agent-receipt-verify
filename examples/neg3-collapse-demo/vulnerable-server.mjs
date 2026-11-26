// A minimal, deliberately broken pair to vulnerable-server.mjs. Not a real x402
// facilitator and not a copy of any existing one; a small illustration of the one
// mistake x402 specification section 5.5 forbids.
//
// WHAT THIS DOES WRONG. Section 5.5 requires that the artifact which ties /settle,
// refusal handling, and replay-lookup to one attempt be derived exactly once, at
// ingress, from the complete request snapshot, and never re-derived downstream. This
// server captures a correct ingress snapshot (so a check that only looks at ingress
// would see nothing wrong), but settle(), refusal(), and replayLookup() each ignore
// the stored ingress identity and independently recompute their own, live, from only
// method+path+query. The amount is left out of that recomputation.
//
// THE CONSEQUENCE. Two different, equally valid requests to the same endpoint that
// differ only in amount produce two different ingress identities (correctly) but the
// SAME settle-time identity (incorrectly), because the amount never enters the
// downstream recomputation. A later request for a higher amount can then settle, or be
// looked up as a replay, under the identity of an earlier, cheaper one.
//
// This is not a hypothetical shape: vectors/attempt-identity/changed-amount-silent-
// collapse.json in this repository encodes the same story as a static fixture, and
// StelarDigital/x402-receipts records fixing a sibling case (a query-only identity that
// ignored the body) as a historical incident at x402-foundation/x402#3325. This file
// makes that same mistake runnable, so it can be seen rather than only read.

import { velddigest } from "../../src/attempt-identity.mjs";

export function ingress(req) {
  const snapshot = {
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    payTo: req.payTo,
    asset: req.asset,
    network: req.network,
    amount: req.amount,
    scheme: req.scheme,
  };
  return { snapshot, identity: velddigest(snapshot) };
}

// The violation: re-derives from a live read of the request, at call time, over a
// narrower set of fields than the ingress snapshot carried. Amount is not among them.
function rederiveDownstream(req) {
  return velddigest({ method: req.method, path: req.path, query: req.query });
}

export function settle(req, _ingressResult) {
  return rederiveDownstream(req);
}

export function refusal(req, _ingressResult) {
  return rederiveDownstream(req);
}

export function replayLookup(req, _ingressResult) {
  return rederiveDownstream(req);
}
