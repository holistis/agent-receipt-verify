# agent-receipt-verify

Independent verification of payment- and outcome-proof receipts used by AI agents.

An agent economy has two kinds of receipt. One says **who was allowed to act**
(delegation: UCAN, Authproof, Agent Passport). The other says **what was paid for
and whether the output matches** (settlement and outcome: x402 offer-receipt, INAM
countersigned receipts, and the proofs ERC-8004 consumers count).

`receipt-commons/receipt-interop` covers the first kind. This covers the second.

## Why independent implementations matter

A receipt signed by a seller is a statement by an interested party. It only becomes
evidence when someone who was not the signer can recompute it and reach the same
conclusion. So every verifier here is written against the published specification,
never against the reference implementation's source, and is tested against the
vector files published by the protocol's own authors.

If two implementations that have not seen each other's code agree on the same
vectors, that is interop. One implementation agreeing with itself proves nothing.

## Status

| Format | Vectors by | Cases | Our verdicts match |
|---|---|---|---|
| INAM countersigned | inamprotocol/inam-protocol @ d5e5f45 | 4 | 4 / 4, identical failed-check sets |
| x402 offer-receipt (commitment §5.6) | x402-foundation/x402 @ 0e492d6 | 1 published example plus 6 own edge cases | yes, byte-identical |

Run it:

```sh
node test/interop.mjs        # both formats, one verdict
node src/inam-countersigned.mjs vectors/inam/vectors.json
```

Node built-ins only, apart from keccak256. No network. No keys of our own.

## Honest limits

These checks test the **form** of a receipt: signatures, content addressing, and
whether the hashes match the bytes a counterparty observed. They do not tell you
whether an operator is honest, whether a registry holds the receipt as finalized,
or whether the money actually moved. Those need live state and are out of scope
here on purpose.

## Provenance and license

Apache-2.0, the same licence both verified projects use. Their published test material is
redistributed unmodified with attribution; see NOTICE for the exact commits. Neither
project has reviewed or endorsed this repository.
