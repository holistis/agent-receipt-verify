# An independent checker for the section 5.5 known-answer vectors

This directory holds a checker for the known-answer vectors of x402 specification v2, section 5.5 (Settlement and Refusal Identity Invariant), written from the text of that section rather than from any implementation of it.

Python 3 standard library only. No third-party packages, no network, no account. That constraint is the point: a checker that imports the same canonicalization library as the implementation it checks cannot show that the text alone determines the answer.

Author: Rachel ([@ruiruii](https://github.com/ruiruii)).
License: Apache-2.0, see the header of each file.

## What it checks

The eleven inputs of `specs/conformance/attempt-identity/` in `x402-foundation/x402`, each published as a pair: the value the section prescribes (`known-answer-<name>.json`, expected `PASS`) and a plausible wrong value (`known-answer-<name>-wrong.json`, expected `FAIL`). Twenty-two files, eleven right and eleven wrong.

| Input | What it pins |
| --- | --- |
| `query-uppercase-hex-and-arrival-order` | uppercase hex; pairs stay in arrival order |
| `query-repeated-keys-keep-order` | repeated names keep the order of their values |
| `query-plus-stays-plus` | a literal `+` is not a space |
| `query-bare-name-stays-bare` | `q` is not `q=` |
| `query-semicolon-is-not-a-separator` | only `&` separates pairs |
| `query-decode-then-encode` | an encoded unreserved character becomes plain |
| `query-invalid-utf8-stays-octets` | a non-UTF-8 byte stays that octet |
| `body-json-rfc8785` | JSON canonicalized with RFC 8785, then SHA-256 |
| `body-gzip-then-rfc8785` | `Content-Encoding` reversed before canonicalization |
| `body-iso-8859-1-is-latin1` | each ISO-8859-1 byte is the code point of the same number |
| `body-duplicate-keys-hashed-as-bytes` | duplicate keys: decoded bytes hashed, no canonicalization |

## How to run

The vector files ship beside this script in `vectors/`, so the default runs against them with no arguments beyond the directory:

```sh
cd interop/python

python3 verify_known_answers.py .

# show the computed value for every field, not only mismatches
python3 verify_known_answers.py . --verbose

# machine-readable
python3 verify_known_answers.py . --json

# or point it at the published directory instead
python3 verify_known_answers.py path/to/specs/conformance/attempt-identity
```

Exit code 0 when every file behaves as its `expected.outcome` says, 1 otherwise.

## What a mismatch looks like

```
FAIL MISMATCH   attempt-identity-known-answer-query-plus-stays-plus  (expected PASS)
       - query: DIFFERS
         recorded: a=b%20c
         computed: a=b%2Bc
         reading : RFC 3986: arrival order, & only, decode then re-encode, + stays +
```

Every mismatch names three things: the field, the recorded value, the value this checker computed, and the reading of the text that produced it. That fourth part is there on purpose. Without it a reader cannot tell a genuine disagreement between implementations from an ambiguity in the section, and those two need different fixes.

## How the eleven right values were checked

The recorded values were computed by two implementations written separately (JavaScript and a Python standard library one) that share no code, and they agree on all eleven. This is a third implementation, written from the text alone. It agrees with all eleven right values and rejects all eleven wrong ones.

An agreement on the right values alone is weak evidence, because an implementation that computes nothing and answers "looks fine" also agrees. The eleven wrong files are what make the check meaningful: rejecting them requires the checker to actually compute something different from the recorded value.

## Tests

```sh
python3 test_verify_known_answers.py .
```

Eighteen tests in three groups:

1. **Published vectors** — all 22 files behave as expected, and the split is eleven and eleven.
2. **Rules** — one test per rule in the section's Query bullet and per body branch, asserting both the value and the difference from the plausible wrong reading.
3. **Mutants** — each mutant breaks one rule (sorts the pairs, reads `+` as a space, lowercases the hex, computes nothing) and the checker must then disagree with the record. A mutant that survives means the corresponding assertion was not testing anything, whatever colour it showed.

## Limits, stated rather than hidden

These are the places where the section does not fully determine the answer and this checker had to choose. Each is a place where a different reading is defensible, and where the vectors would have to move if the section decides otherwise.

- **An empty query segment** (`a=1&&b=2`) is dropped. The section does not settle this.
- **A `%` not followed by two hex digits** is kept as a literal percent sign. The section does not settle this either; the published README names it as the one point of the text not pinned by these vectors.
- **Numbers in RFC 8785.** JCS requires the ECMAScript shortest round-trip form. Python's `repr` uses the same algorithm for doubles, and this checker applies the two shape fixes JCS demands (no `+` in the exponent, no trailing `.0`). None of the eleven vectors exercises a hard number case, so this path is present but not pinned by them.
- **Nested duplicate keys.** The duplicate-key branch is reached when any object in the body repeats a key, including after unescaping. The section states the rule; the vector exercises it at the top level only.
- **Only two fields are checked**, `query` and `body_sha256`, because those are the two the vectors record. Anything else in `observed` is reported as not checked rather than silently passed.

These vectors pin canonical members, not a whole identity. They say nothing about how the members are combined or hashed into one. A checker of members cannot stand in for a checker of identities.

## Provenance

The vector files are byte-for-byte copies from `specs/conformance/attempt-identity/` of the branch `docs/attempt-identity-known-answer-vectors` (pull request x402-foundation/x402#3958), which itself copies them from `vectors/attempt-identity/` of `holistis/agent-receipt-verify` at commit `a295fe9`. They are not modified here.

The checker is written from the text of section 5.5 as proposed in x402-foundation/x402#3776, checked against commit `2819ed7` (the arrival-order query rule).
