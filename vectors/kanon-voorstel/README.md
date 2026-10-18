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
