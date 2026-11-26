import * as naive from "./naive-handler.mjs";
import * as fixed from "./fixed-handler.mjs";

const fullySuccessful = [
  { name: "step-a", ok: true, result: { status: "done" } },
  { name: "step-b", ok: true, result: { status: "done" } },
];

const oneStepFailed = [
  { name: "step-a", ok: true, result: { status: "done" } },
  { name: "step-b", ok: false, result: { status: "failed", reason: "upstream timeout" } },
];

console.log("naive-handler.mjs (binds only the outer `ok` flag)");
const naiveFull = naive.runComposite(fullySuccessful);
const naiveFailed = naive.runComposite(oneStepFailed);
const naiveReceiptFull = naive.receiptFor(naiveFull);
const naiveReceiptFailed = naive.receiptFor(naiveFailed);
console.log("  fully successful request  -> receipt", naiveReceiptFull);
console.log("  one sub-step failed       -> receipt", naiveReceiptFailed);
console.log(
  naiveReceiptFull === naiveReceiptFailed
    ? "  COLLISION: a fully successful request and a partially failed one settle under the SAME receipt."
    : "  (no collision)"
);

console.log("\nfixed-handler.mjs (binds the sub-results, degraded flag and missing list)");
const fixedFull = fixed.runComposite(fullySuccessful);
const fixedFailed = fixed.runComposite(oneStepFailed);
const fixedReceiptFull = fixed.receiptFor(fixedFull);
const fixedReceiptFailed = fixed.receiptFor(fixedFailed);
console.log("  fully successful request  -> receipt", fixedReceiptFull);
console.log("  one sub-step failed       -> receipt", fixedReceiptFailed);
console.log(
  fixedReceiptFull !== fixedReceiptFailed
    ? "  OK: the two requests settle under two different receipts, the degraded delivery is visible."
    : "  COLLISION (unexpected)."
);

console.log(
  "\nAs expected: the naive handler collapses a degraded delivery into the same receipt as a clean one; the fixed handler does not."
);
