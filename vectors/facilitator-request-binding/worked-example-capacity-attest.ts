// Worked example for epistemedeus' question on x402-foundation/x402#3776:
// "two calls to the same tool with different arguments at the same price:
// what binds each result to its own claim, and what does a mismatched
// result do?"
//
// Uses capacity-attest's REAL, unmodified exported functions (recordDelivery,
// computeClaimId, verifyClaim, signClaim, buildSignedClaim) against a
// disposable ledger directory (CAPACITY_ATTEST_DATA_DIR), not the production
// one. No mocking of the claim/signature/ledger logic itself.
//
// To run: clone github.com/holistis/tokenizen, `npm install` inside
// packages/capacity-attest, then from that same directory run
// `npx tsx /path/to/worked-example-capacity-attest.ts` (or set
// CAPACITY_ATTEST_SRC_DIR to point at a capacity-attest/src elsewhere).
// Pinned against commit ce70b898 of that repository.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

process.env["CAPACITY_ATTEST_DATA_DIR"] = mkdtempSync(join(tmpdir(), "capacity-attest-worked-example-"));

const CAPACITY_ATTEST_SRC = process.env["CAPACITY_ATTEST_SRC_DIR"] || "../capacity-attest/src";
const toUrl = (rel: string) => pathToFileURL(join(CAPACITY_ATTEST_SRC, rel)).href;
const { recordDelivery } = await import(toUrl("tools.ts"));
const { computeClaimId, StrictDeliveryClaimSchema } = await import(toUrl("schema.ts"));
const { verifyClaim, signClaim } = await import(toUrl("signing.ts"));
const { testWallet, buildSignedClaim, evidenceHash } = await import(toUrl("test-helpers.ts"));

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const buyer = testWallet();

// --- Scenario: two MCP tool calls to record_delivery, same tool, same flat
// price (the price is fixed at the tool-config level in http-server.ts and
// never depends on claim content; capacity-attest's ClaimContent schema has
// no price/amount field at all -- there is nothing content-dependent for a
// facilitator-visible fixed resource.url to need to distinguish in the first
// place). Different arguments: call A reports delivery of one GPU job, call
// B a different, unrelated one.
section("Call A and Call B: real, independently signed claims");
const claimA = await buildSignedClaim(buyer, {
  promisedSpec: "1x A100, 4 hours, us-east region",
  evidenceHash: evidenceHash("evidence payload for job A"),
});
const claimB = await buildSignedClaim(buyer, {
  promisedSpec: "2x H100, 1 hour, eu-west region",
  evidenceHash: evidenceHash("evidence payload for job B"),
});
console.log("claimA.claimId:", claimA.claimId);
console.log("claimB.claimId:", claimB.claimId);
console.log("claimIds differ:", claimA.claimId !== claimB.claimId);

section("Why they can never collide: claimId is a content hash, not a slot number");
console.log(
  "computeClaimId() hashes sha256(canonical JSON of {sellerAddress, buyerAddress, assetType,",
  "promisedSpec, delivered, evidenceHash, settlementRef, timestamp[, priorClaimId]}).",
  "Two calls with different promisedSpec/evidenceHash/timestamp hash to different",
  "digests by construction, independently of anything the facilitator saw.",
);

section("Both claims record correctly, each under its own claimId");
const resultA = await recordDelivery(claimA);
const resultB = await recordDelivery(claimB);
console.log("record(A):", resultA);
console.log("record(B):", resultB);

section("MISMATCH ATTEMPT 1: graft B's content onto A's claimId+signature");
const frankenClaim1 = { ...claimB, claimId: claimA.claimId, signature: claimA.signature };
const attempt1 = await recordDelivery(frankenClaim1);
console.log("record(B-content + A-claimId/signature):", attempt1);

section("MISMATCH ATTEMPT 2: graft A's content onto B's claimId+signature");
const frankenClaim2 = { ...claimA, claimId: claimB.claimId, signature: claimB.signature };
const attempt2 = await recordDelivery(frankenClaim2);
console.log("record(A-content + B-claimId/signature):", attempt2);

section("MISMATCH ATTEMPT 3: forge a claim with a THIRD party's content, A's signature");
const forged = await buildSignedClaim(testWallet(), { promisedSpec: "forged, no real delivery" });
const frankenClaim3 = { ...forged, signature: claimA.signature };
const attempt3 = await recordDelivery(frankenClaim3);
console.log("record(forged-content + A-signature):", attempt3);

section("MISMATCH ATTEMPT 4: replay A's exact, valid claim a second time");
const replay = await recordDelivery(claimA);
console.log("record(A) again, verbatim:", replay);

section("Control: does verifyClaim() alone (no ledger) independently confirm the same verdicts?");
console.log("verifyClaim(frankenClaim1):", verifyClaim(frankenClaim1));
console.log("verifyClaim(frankenClaim2):", verifyClaim(frankenClaim2));
console.log("verifyClaim(frankenClaim3):", verifyClaim(frankenClaim3));

section("Summary");
const allRejected = !attempt1.ok && !attempt2.ok && !attempt3.ok && !replay.ok;
console.log("All four mismatch/replay attempts rejected:", allRejected);
console.log("resultA.ok && resultB.ok (both legitimate claims recorded):", resultA.ok && resultB.ok);
