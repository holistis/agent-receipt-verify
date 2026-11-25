// The same shape as vulnerable-server.mjs, built to x402 specification section 5.5
// instead of against it. The only difference: the identity is derived exactly once, at
// ingress, from the complete snapshot, and every downstream path reuses that same
// value instead of recomputing anything.

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

// No re-derivation. Each path is handed the ingress result and reuses its identity
// unchanged. There is nothing here for a later field to leak into.
export function settle(_req, ingressResult) {
  return ingressResult.identity;
}

export function refusal(_req, ingressResult) {
  return ingressResult.identity;
}

export function replayLookup(_req, ingressResult) {
  return ingressResult.identity;
}
