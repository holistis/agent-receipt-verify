# Second implementation of the known answers

A canonicalizer for the query and the body digest of section 5.5, written separately from src/canonical-request.mjs, using only the Python standard library. It reads a JSON list of raw requests on standard input (method, path, query, contentType, contentEncoding, bodyBase64) and prints the canonical query and the body SHA-256 of each.

    python -I second-implementation.py < raw-requests.json

The known-answer vectors in vectors/attempt-identity were generated only when this script and the JavaScript checker agreed on every input. We wrote both, so this is not a check by someone else.
