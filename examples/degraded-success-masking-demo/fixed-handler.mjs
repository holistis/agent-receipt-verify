// Same composite shape as naive-handler.mjs, built to minia2auk's proposal instead of
// against it: the receipt binds a digest of the sub-results themselves, not just the
// outer envelope's `ok` field. A failed sub-step changes this digest even when the
// outer handler still happens to return ok:true.

import { velddigest } from "../../src/attempt-identity.mjs";

export function runComposite(subSteps) {
  const results = subSteps.map((s) => s.result);
  const ok = true; // same naive outer assumption as naive-handler.mjs on purpose --
  // the fix is not in the handler's ok logic, it is in what the RECEIPT binds to.
  const allSubStepsOk = subSteps.every((s) => s.ok);
  return { ok, results, degraded: !allSubStepsOk, missing: subSteps.filter((s) => !s.ok).map((s) => s.name) };
}

export function receiptFor(envelope) {
  // Binds the sub-results and the degraded/missing fields, not just `ok`. This is
  // minia2auk's "honest-degraded case": ok:true with degraded:true and a missing list
  // is a legitimate delivery, but only if the receipt carries the same list.
  return velddigest({ results: envelope.results, degraded: envelope.degraded, missing: envelope.missing });
}
