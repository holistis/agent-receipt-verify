# Extra known-answer vectors for section 5.5

Cite as: github.com/holistis/agent-receipt-verify, vectors/attempt-identity-extra, 2026-11-20.

Four pairs, eight files, next to the 22 frozen files in `vectors/attempt-identity`. They change none of the 22 and are not part of them: the 22 are frozen and published elsewhere under that count, so a rule they leave open is added here as new files.

## Why they exist

On 2026-11-20 we planted 23 plausible mistakes, one at a time, in a copy of our own `src/canonical-request.mjs`. The 22 files and the interop harness caught 11. 12 passed. Running the other tests of this repository on the same 12 caught four more, so 8 passed everything. Four of the 8 are rules that standards settle: RFC 9110 for deflate and for the order of several encodings, RFC 2978 for charset names that do not depend on case, and RFC 6839 for the +json suffix. Section 5.5 tells an implementation to reverse the content-encoding, decode the charset and canonicalize a JSON body; it does not spell out these four cases itself. These eight files pin them:

| pair | the rule | the mistake it catches |
|---|---|---|
| `body-deflate-then-rfc8785` | a deflate body (the zlib format of HTTP) is decompressed, then canonicalized | deflate read as gzip, or the decompressed body hashed as written |
| `body-content-encodings-reversed-in-order` | `Content-Encoding: deflate, gzip` lists the order they were applied, so they are undone from the last to the first | the order not reversed, or the transmitted bytes hashed |
| `body-charset-name-is-case-insensitive` | `charset=ISO-8859-1` in capitals is Latin-1, so byte 0x80 is U+0080 and not the euro sign | the capitalized name read as windows-1252 |
| `body-plus-json-media-type-is-json` | a media type with a `+json` suffix is JSON and is canonicalized with RFC 8785 | the body hashed as written |

Each right file has a wrong twin with the same input and a plausible wrong answer, the shape of the 22. An implementation has to compute, on the wrong file, the value its right twin records.

## What is not pinned

Four of the 8 stay open. Empty segments in a query (we drop them) and a body that is not valid in its declared charset (we refuse it) are choices that nothing we know of settles. The `x-gzip` alias is a legacy name that RFC 9110 says to treat as gzip, and we accept it, but no file pins that yet. Brotli needs a library that the second reader, which uses only the Python standard library, does not have.

## How to run

    npm run interop-extra

Two separately written implementations, our Node code and the Python standard library checker in `interop/python`, read the eight files and are judged by the same rules as the 22. The Python checker now undoes a list of encodings from the last to the first; before, it accepted one. `npm test` runs `test/attempt-identity-extra.mjs`, which freezes the eight files and checks that an implementation making each mistake is caught.

## Limits

Nobody outside this project has checked these eight values yet. They were computed by our Node implementation and reproduced by the Python checker, and the wrong values come from the mistakes named above. They say nothing about the rest of the identity.
