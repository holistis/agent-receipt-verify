# Two cases no published vector covers

These are PROPOSALS, not published vectors. They sit in their own directory on purpose:
the benchmark in `bench/eip3009-beleid.mjs` reads `vectors/kanon` and must keep reporting
ten, because the moment our own proposals are counted as published vectors, the measurement
starts flattering us.

Both come out of the two open questions in `x402-foundation/x402#2725`.

## 1. amount-overpaid-001

The signature is authentic and signs a value one unit ABOVE the accepted amount. No
published vector covers this direction, so a verifier can pass all ten and still disagree
with two reference implementations.

Measured, with the citations verified against the live files on 18 October 2026:

| where | line | what it does |
| --- | --- | --- |
| `go/mechanisms/evm/exact/facilitator/eip3009.go` | 65 | `parsedAuthorization.Value.Cmp(requiredValue) != 0`, strict equality |
| `python/x402/mechanisms/evm/exact/facilitator.py` | 235 | `int(...value) != int(requirements.amount)`, strict equality |
| `python/x402/mechanisms/evm/exact/facilitator.py` | 168 | docstring, "Amount exactly matches requirements.amount" |
| `specs/schemes/exact/scheme_exact_evm.md` | 79 | the parameters must "meet" the requirements, which does not say equal |

Our own runner on this vector:

| policy | verdict | reason code |
| --- | --- | --- |
| exact (our default) | not valid | `AMOUNT_INSUFFICIENT` |
| at-least | valid | `VALID` |

The `expected.reason_code` in the vector is `AMOUNT_MISMATCH`, and our own runner does not
return it. That disagreement is deliberate and it is the second half of the finding: no
published enum carries a code for this direction, and `AMOUNT_INSUFFICIENT` is the wrong
word for an overpayment. Go names its error `ErrAuthorizationValueMismatch`. Whether to add
the code is a decision for the spec, so we left our implementation as it is and wrote the
disagreement down instead of quietly renaming it.

## 2. nonce-spent-by-other-payer-001

The same nonce is already spent, by a DIFFERENT payer. EIP-3009 tracks spent authorizations
per authorizer, `mapping(address => mapping(bytes32 => bool))`, readable as
`authorizationState(address authorizer, bytes32 nonce)`. A verifier holding a flat list
without the payer is therefore STRICTER than the contract: it refuses a payment the chain
would accept, which for a facilitator is a refused settlement and not a safety margin.

Our runner returns valid under both policies, which matches the contract. The context shape
keys `seen_nonces` by payer address; the published set has only the flat list form.

## 3. Two ERC-6492 cases (x402#3925)

Proposals, like the two above, and for the same reason they stay out of `vectors/kanon`. They follow the text of x402 pull request 3925 at commit d0dcbf42, which is not merged: a signature that ends with the ERC-6492 magic suffix, from a payer without code, is accepted only through the deployment path and never by removing the wrapper and checking the inner signature with `ecrecover`.

- `x402-evm-eip3009-erc6492-incomplete-wrapper-001`: the baseline authorization and its valid low-s signature in a wrapper with a zero factory and empty calldata. There is no deployment path, so it must be refused. Reason code (ours, not published): `ERC6492_NO_DEPLOYMENT_PATH`.
- `x402-evm-eip3009-erc6492-factory-not-allowed-001`: a complete wrapper (non-zero factory, non-empty calldata) whose factory is not allowlisted. Reason code (ours): `ERC6492_FACTORY_NOT_ALLOWED`.

What was measured. robertolocatelli81-dev ran the three reference facilitators on 26 October 2026 (pull request 3925, comment 6425457514): for the incomplete wrapper TypeScript rejects and Go and Python verify it as valid. We ran our own verifier before the change: every wrapped form came back as `SIGNER_MISMATCH`, a refusal for the wrong reason, because the wrapper was not recognized. The verifier on this branch recognizes the wrapper. A complete wrapper with an allowlisted factory cannot be judged offline, it needs a simulation that deploys the account and makes the transfer together, so it is reported as not measured and there is no vector for it.
