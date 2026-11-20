# Interop harness for the section 5.5 known-answer vectors

Cite as: github.com/holistis/agent-receipt-verify, interop, 2026-11-20.

Two independent implementations read the same 22 files in `vectors/attempt-identity/known-answer-*.json` and are judged side by side:

- our Node implementation, `src/canonical-request.mjs`
- the Python checker in [`python/`](./python/README.md), standard library only, written from the text of the section by Rachel (github.com/ruiruii), Apache-2.0

Run it (needs Node and Python 3):

    npm run interop

`run-interop.mjs` prints one line per rule and, for every violation, the file, the field, the recorded value, what each implementation computed, the value the right twin records, and the reading of the text the Python checker applied. Exit 0 means no violation, 1 means at least one, 2 means the harness itself could not run (no Python, unreadable output), which is never a pass.

## The rules

The published verdict for a wrong file is "it passes as soon as the computed value differs from the recorded one". That is true for any reason, so a checker that returns the same constant for every field would pass all eleven wrong files. The harness adds the twin rule: a wrong file must differ for the right reason.

| Rule | What it checks |
|---|---|
| SET | every right file has a wrong twin and the other way round; with `--expect=22` exactly that many files |
| ALIGN | both implementations returned the same fields, in the same order, for every file |
| R1 | a wrong value really differs from the value its right twin records |
| R2 | the two implementations compute the same value for every field |
| R3 | on a right file both compute exactly the recorded value |
| R4 | on a wrong file both compute what the right twin records |
| R5 | the copies in `python/vectors/` are byte for byte the files in `vectors/attempt-identity/` (CRLF turned into LF before comparing) |

## Test of the tester

`npm test` runs `test/interop-run.mjs`. The judge is a pure function, so the test hands it wrong implementations and damaged file sets: a checker that returns a constant (R3 catches all 11 right files, R4 all 11 wrong files), a checker that repeats the record, one changed field, a wrong file that is not wrong, a missing twin, a changed, missing or extra copy, copies with Windows line endings (must still be equal), an implementation that returns no fields. The test needs no Python.

## Not covered

- The harness reads the files and the two implementations; it does not fetch anything and does not check the section text itself.
- The Python side is only as independent as its author's reading of the section. It imports no shared library with the Node side, which is the point, but both sides are small and written against the same vectors.
- Two cases the section does not settle (an empty query segment is dropped, a `%` not followed by two hex digits stays a literal percent sign) are declared in `python/README.md`; if the section decides either way, the vectors and the checkers move together.

License: Apache-2.0, same as the rest of this repository.
