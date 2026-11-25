// Confirms examples/neg3-collapse-demo/run-demo.mjs actually shows the contrast it
// claims: the vulnerable server collapses two different requests into one settle
// identity, the fixed server does not. This is a real, automated test, not only a
// script someone has to run and read by eye.
//
// It also checks the fixed server structurally: settle() is handed a request object
// that does not match the ingress result on purpose, and must still return the ingress
// identity unchanged. A fixed-server.mjs that regresses into reading req again, for any
// field, fails this even if the two-request scenario above happened not to collide.

import { runAgainst } from "../examples/neg3-collapse-demo/run-demo.mjs";
import * as vulnerable from "../examples/neg3-collapse-demo/vulnerable-server.mjs";
import * as fixed from "../examples/neg3-collapse-demo/fixed-server.mjs";

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

console.log("the demo reproduces the documented contrast");

const vulnerableResult = runAgainst(vulnerable);
t(
  "vulnerable-server.mjs: a quoted request and an overcharged request collapse to the same settle identity",
  vulnerableResult.collapsed === true,
  JSON.stringify(vulnerableResult.settleQuoted) + " vs " + JSON.stringify(vulnerableResult.settleOvercharged),
);
t(
  "vulnerable-server.mjs: the two ingress identities still differ, so the ingress snapshot itself was not the problem",
  vulnerableResult.ingressQuoted.identity !== vulnerableResult.ingressOvercharged.identity,
);

const fixedResult = runAgainst(fixed);
t(
  "fixed-server.mjs: a quoted request and an overcharged request settle under two different identities",
  fixedResult.collapsed === false,
  JSON.stringify(fixedResult.settleQuoted) + " vs " + JSON.stringify(fixedResult.settleOvercharged),
);

// Structural check: feed fixed.settle() a request that does not match the ingress
// result it is handed. A conforming implementation must ignore the request entirely at
// this point and return the ingress identity unchanged -- if it regresses into reading
// the request again, this mismatched req will leak through and change the result.
const ingressA = fixed.ingress({
  method: "POST",
  path: "/x402/pay",
  query: "item=widget",
  body: "",
  payTo: "0x2888f36548a900b9b08d584524e1f73bc563ec26",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  network: "eip155:8453",
  amount: "1000",
  scheme: "exact",
});
const unrelatedReq = { method: "DELETE", path: "/totally/different", query: "x=y", amount: "999999" };
const settleWithMismatchedReq = fixed.settle(unrelatedReq, ingressA);
t(
  "fixed-server.mjs: settle() ignores the request it is handed and only trusts the ingress result",
  settleWithMismatchedReq === ingressA.identity,
  "got " + JSON.stringify(settleWithMismatchedReq) + ", expected the ingress identity " + JSON.stringify(ingressA.identity),
);

// A mutation the vector suite already prices in elsewhere in this repository: a demo
// that could never fail would prove nothing. Confirm the vulnerable server really can
// fail the same structural check the fixed server just passed, so the check above is
// not vacuously true for any function someone could have written.
const vulnerableIngressA = vulnerable.ingress({
  method: "POST",
  path: "/x402/pay",
  query: "item=widget",
  body: "",
  payTo: "0x2888f36548a900b9b08d584524e1f73bc563ec26",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  network: "eip155:8453",
  amount: "1000",
  scheme: "exact",
});
const vulnerableSettleWithMismatchedReq = vulnerable.settle(unrelatedReq, vulnerableIngressA);
t(
  "vulnerable-server.mjs: the same structural check correctly fails on the broken server (proves the check is reachable)",
  vulnerableSettleWithMismatchedReq !== vulnerableIngressA.identity,
);

console.log("");
console.log(goed + " passed, " + fout + " failed");
if (fout > 0) process.exitCode = 1;
