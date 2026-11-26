// A composite handler the way minia2auk described it on x402-foundation/x402#2887
// (2026-11-26): several upstream sub-steps, one outer envelope. The outer `ok` comes
// from the happy-path return, so a failed sub-step that still returns a response
// object (rather than throwing) never reaches the outer failure branch.
//
// The receipt here binds ONLY the outer envelope's top-level `ok` field, exactly the
// signal minia2auk said settlement actually reads in production.

import { velddigest } from "../../src/attempt-identity.mjs";

export function runComposite(subSteps) {
  // subSteps: array of { name, ok, result }. A sub-step that failed still returns a
  // well-formed object with ok:false; it does not throw.
  const results = subSteps.map((s) => s.result);
  const ok = true; // the bug: this is the handler's own happy-path assumption, not
  // derived from the sub-steps. It is what makes this "naive" rather than malicious --
  // the same class of bug minia2auk reported finding in production.
  return { ok, results };
}

export function receiptFor(envelope) {
  // Binds only the top-level ok flag, the "one signal settlement reads".
  return velddigest({ ok: envelope.ok });
}
