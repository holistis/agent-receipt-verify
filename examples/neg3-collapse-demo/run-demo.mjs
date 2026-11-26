// Runs the same two requests against vulnerable-server.mjs and fixed-server.mjs and
// prints what each one settles them as. No network, no account, no key.
//
// node examples/neg3-collapse-demo/run-demo.mjs

import * as vulnerable from "./vulnerable-server.mjs";
import * as fixed from "./fixed-server.mjs";

const quotedRequest = {
  method: "POST",
  path: "/x402/pay",
  query: "item=widget",
  body: "",
  payTo: "0x2888f36548a900b9b08d584524e1f73bc563ec26",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  network: "eip155:8453",
  amount: "1000",
  scheme: "exact",
};

const overchargedRequest = { ...quotedRequest, amount: "2000" };

export function runAgainst(server) {
  const ingressQuoted = server.ingress(quotedRequest);
  const ingressOvercharged = server.ingress(overchargedRequest);
  const settleQuoted = server.settle(quotedRequest, ingressQuoted);
  const settleOvercharged = server.settle(overchargedRequest, ingressOvercharged);
  const collapsed = settleQuoted === settleOvercharged;
  return { ingressQuoted, ingressOvercharged, settleQuoted, settleOvercharged, collapsed };
}

function short(hex) {
  return hex.slice(0, 12) + "...";
}

function report(label, server) {
  const r = runAgainst(server);
  console.log("\n" + label);
  console.log(
    "  quoted request      amount=" + quotedRequest.amount + "  -> settle identity " + short(r.settleQuoted),
  );
  console.log(
    "  overcharged request amount=" + overchargedRequest.amount + "  -> settle identity " + short(r.settleOvercharged),
  );
  if (r.collapsed) {
    console.log("  COLLISION: two different, valid requests settle under the SAME identity.");
    console.log("  The overcharge can settle, or be matched as a replay, as if it were the quoted request.");
  } else {
    console.log("  OK: the two requests settle under two different identities, as x402 section 5.5 requires.");
  }
  return r;
}

// Only print and exit when run directly (`node run-demo.mjs`), not when imported for
// `runAgainst` by test/neg3-collapse-demo.mjs.
if (process.argv[1]?.endsWith("run-demo.mjs")) {
  const vulnerableResult = report(
    "vulnerable-server.mjs (re-derives the settle identity downstream, from path+query only)",
    vulnerable,
  );
  const fixedResult = report(
    "fixed-server.mjs (derives the identity once, at ingress, from the full snapshot)",
    fixed,
  );

  console.log("");
  if (!vulnerableResult.collapsed || fixedResult.collapsed) {
    console.error("Unexpected: this run did not reproduce the documented contrast. See test/neg3-collapse-demo.mjs.");
    process.exitCode = 1;
  } else {
    console.log("As expected: the vulnerable server collapses two different requests into one identity, the fixed server does not.");
  }
}
