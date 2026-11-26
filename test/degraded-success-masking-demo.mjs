// Confirms examples/degraded-success-masking-demo/run-demo.mjs actually shows the
// contrast it claims: naive-handler.mjs (binding only the outer `ok` flag) collapses a
// fully successful request and a partially failed one into the same receipt;
// fixed-handler.mjs (binding the sub-results, degraded flag and missing list) does not.
// This is the failure mode minia2auk reported on x402-foundation/x402#2887
// (2026-11-26): a composite handler whose outer envelope says ok:true while a sub-step
// actually failed.

import * as naive from "../examples/degraded-success-masking-demo/naive-handler.mjs";
import * as fixed from "../examples/degraded-success-masking-demo/fixed-handler.mjs";

let goed = 0;
let fout = 0;
const t = (naam, ok, extra = "") => {
  if (ok) {
    goed++;
    console.log("  pass  " + naam);
  } else {
    fout++;
    console.log("  FAIL  " + naam + (extra ? "  <- " + extra : ""));
  }
};

const fullySuccessful = [
  { name: "step-a", ok: true, result: { status: "done" } },
  { name: "step-b", ok: true, result: { status: "done" } },
];
const oneStepFailed = [
  { name: "step-a", ok: true, result: { status: "done" } },
  { name: "step-b", ok: false, result: { status: "failed", reason: "upstream timeout" } },
];

console.log("the demo reproduces the documented contrast");

const naiveFullReceipt = naive.receiptFor(naive.runComposite(fullySuccessful));
const naiveFailedReceipt = naive.receiptFor(naive.runComposite(oneStepFailed));
t(
  "naive-handler.mjs: a fully successful request and a partially failed one collapse to the same receipt",
  naiveFullReceipt === naiveFailedReceipt,
  naiveFullReceipt + " vs " + naiveFailedReceipt,
);

const fixedFullReceipt = fixed.receiptFor(fixed.runComposite(fullySuccessful));
const fixedFailedReceipt = fixed.receiptFor(fixed.runComposite(oneStepFailed));
t(
  "fixed-handler.mjs: a fully successful request and a partially failed one settle under two different receipts",
  fixedFullReceipt !== fixedFailedReceipt,
  fixedFullReceipt + " vs " + fixedFailedReceipt,
);

// Honest-degraded case from the same comment: ok:true with degraded:true and a missing
// list is a legitimate delivery, but two DIFFERENT missing lists must still produce two
// different receipts, otherwise "degraded in way A" and "degraded in way B" look
// identical downstream, which is the same masking bug one level down.
const missingStepB = [
  { name: "step-a", ok: true, result: { status: "done" } },
  { name: "step-b", ok: false, result: { status: "failed" } },
];
const missingStepA = [
  { name: "step-a", ok: false, result: { status: "failed" } },
  { name: "step-b", ok: true, result: { status: "done" } },
];
const receiptMissingB = fixed.receiptFor(fixed.runComposite(missingStepB));
const receiptMissingA = fixed.receiptFor(fixed.runComposite(missingStepA));
t(
  "fixed-handler.mjs: degraded delivery missing step-a and degraded delivery missing step-b settle under two different receipts",
  receiptMissingA !== receiptMissingB,
  receiptMissingA + " vs " + receiptMissingB,
);

// Test-the-tester (mutation): a receiptFor() that regressed into binding only `ok`,
// the exact naive bug, must fail the two checks above. Confirms those checks are
// reachable and not vacuously true for any function someone could have written.
const regressedReceiptFor = (envelope) => naive.receiptFor(envelope);
const regressedFullReceipt = regressedReceiptFor(fixed.runComposite(fullySuccessful));
const regressedFailedReceipt = regressedReceiptFor(fixed.runComposite(oneStepFailed));
t(
  "mutation check: a receiptFor() that regressed into binding only the outer ok flag re-collapses the two receipts (proves the check above is reachable)",
  regressedFullReceipt === regressedFailedReceipt,
);

console.log("");
console.log(goed + " passed, " + fout + " failed");
if (fout > 0) process.exitCode = 1;
