#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Rachel (https://github.com/ruiruii)
#
# An independent checker for the x402 specification v2, section 5.5
# (Settlement and Refusal Identity Invariant) known-answer vectors.
#
# Written to the text of the section, not against any implementation of it.
# Python 3 standard library only: no third-party packages, so that "the
# checker works" cannot be explained by "it shares a canonicalization
# library with the thing it checks".
#
# Usage:
#   python3 verify_known_answers.py <directory>
#   python3 verify_known_answers.py <directory> --verbose
#   python3 verify_known_answers.py <directory> --json
#
# The directory holds known-answer-*.json files as published in
# specs/conformance/attempt-identity/ of x402-foundation/x402.
#
# Exit code 0 when every file behaves as its `expected.outcome` says,
# 1 otherwise. A mismatch reports the field, what the text prescribed we
# compute, what the file recorded, and which reading of the text this
# checker applied -- so a reader can tell a real disagreement from an
# ambiguity in the specification.

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import sys
import zlib
from pathlib import Path
from typing import Any

# --------------------------------------------------------------------------
# RFC 3986 percent-encoding
# --------------------------------------------------------------------------

# Unreserved (RFC 3986 section 2.3). These are never percent-encoded.
UNRESERVED = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "0123456789"
    "-._~"
)

# Every byte outside the unreserved set is percent-encoded with uppercase hex.
# This includes sub-delims such as "=", "&", ";", "+" -- they are data here,
# not syntax, because the split into pairs has already happened.
HEX_UPPER = "0123456789ABCDEF"


def percent_encode_octets(octets: bytes) -> str:
    """Encode raw octets as percent-encoded ASCII with uppercase hex.

    Operates on octets, not on characters: a byte that is not valid UTF-8
    is still a byte, and it is encoded as that byte rather than replaced.
    """
    out = []
    for b in octets:
        ch = chr(b)
        if ch in UNRESERVED:
            out.append(ch)
        else:
            out.append("%" + HEX_UPPER[b >> 4] + HEX_UPPER[b & 0x0F])
    return "".join(out)


def percent_decode_octets(text: str) -> bytes:
    """Decode percent-escapes into octets, keeping invalid sequences literal.

    Section 5.5 does not settle what a "%" not followed by two hex digits
    means, so this checker keeps it as a literal percent sign. That choice
    is declared here and in the README rather than left implicit.
    """
    out = bytearray()
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "%" and i + 2 < n + 1 and i + 2 <= n - 1 + 1:
            hexpair = text[i + 1 : i + 3]
            if len(hexpair) == 2 and all(c in "0123456789abcdefABCDEF" for c in hexpair):
                out.append(int(hexpair, 16))
                i += 3
                continue
        # Not a valid escape: the character stands for itself. It is already
        # a character here, so encode it back to octets as UTF-8.
        out.extend(ch.encode("utf-8"))
        i += 1
    return bytes(out)


def canonical_query(query: str) -> str:
    """Canonicalize a raw query string per section 5.5.

    Rules applied, each traceable to the text:
      - only "&" separates pairs; ";" is part of the value
      - pairs keep arrival order; nothing is sorted
      - a name without "=" stays bare ("q" is not "q=")
      - each name and value is percent-decoded to octets, then re-encoded
        with uppercase hex; an encoded unreserved character becomes plain
      - a literal "+" stays a plus (it is not read as a space)
      - an empty segment is dropped
    """
    if query == "":
        return ""

    pairs = []
    for segment in query.split("&"):
        if segment == "":
            # The text does not settle this; the reference checker drops it.
            # Declared in README "Limits".
            continue
        if "=" in segment:
            name_raw, _, value_raw = segment.partition("=")
            name = percent_encode_octets(percent_decode_octets(name_raw))
            value = percent_encode_octets(percent_decode_octets(value_raw))
            pairs.append(name + "=" + value)
        else:
            name = percent_encode_octets(percent_decode_octets(segment))
            pairs.append(name)
    return "&".join(pairs)


# --------------------------------------------------------------------------
# RFC 8785 (JCS) canonicalization, standard library only
# --------------------------------------------------------------------------


def _reject_duplicates(pairs):
    seen = set()
    for k, _ in pairs:
        if k in seen:
            # A body with duplicate keys (also after unescaping) is not
            # canonicalizable; section 5.5 says its decoded bytes are hashed.
            raise _DuplicateKey(k)
        seen.add(k)
    return dict(pairs)


class _DuplicateKey(Exception):
    def __init__(self, key):
        self.key = key
        super().__init__(f"duplicate key after unescaping: {key!r}")


def _sort_key(key: str) -> bytes:
    """JCS sorts object keys by their UTF-16 code unit sequence."""
    return key.encode("utf-16-be")


def jcs_serialize(value: Any) -> str:
    """Serialize a decoded JSON value per RFC 8785.

    Numbers follow the ECMAScript Number::toString shortest round-trip
    form that RFC 8785 requires; Python's repr is the same algorithm for
    the doubles these vectors use, so it is used with the two shape fixes
    JCS demands (no "+" exponent sign, no trailing ".0").
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _jcs_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _jcs_number(value)
    if isinstance(value, list):
        return "[" + ",".join(jcs_serialize(v) for v in value) + "]"
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda kv: _sort_key(kv[0]))
        return "{" + ",".join(_jcs_string(k) + ":" + jcs_serialize(v) for k, v in items) + "}"
    raise TypeError(f"cannot canonicalize {type(value)!r}")


def _jcs_number(x: float) -> str:
    if x == 0:
        return "0"
    if x == int(x) and abs(x) < 1e21:
        return str(int(x))
    text = repr(x)
    if "e" in text or "E" in text:
        mantissa, _, exponent = text.partition("e")
        exp_int = int(exponent)
        text = f"{mantissa}e{'+' if exp_int >= 0 else '-'}{abs(exp_int)}"
    return text


_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def _jcs_string(s: str) -> str:
    out = ['"']
    for ch in s:
        if ch in _ESCAPES:
            out.append(_ESCAPES[ch])
        elif ord(ch) < 0x20:
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


# --------------------------------------------------------------------------
# Body canonicalization
# --------------------------------------------------------------------------

CHARSET_ALIASES = {
    "iso-8859-1": "latin-1",
    "iso8859-1": "latin-1",
    "latin1": "latin-1",
    "us-ascii": "ascii",
}


def _charset_from_content_type(content_type: str | None) -> str:
    if not content_type:
        return "utf-8"
    for part in content_type.split(";"):
        part = part.strip()
        if part.lower().startswith("charset="):
            name = part.split("=", 1)[1].strip().strip('"').lower()
            return CHARSET_ALIASES.get(name, name)
    return "utf-8"


def _is_json(content_type: str | None) -> bool:
    if not content_type:
        return False
    return "json" in content_type.split(";")[0].strip().lower()


def canonical_body(raw: dict) -> tuple[str, str]:
    """Return (body_sha256_hex, reading) for a raw request's body.

    `reading` names the branch of the text that produced the digest, so a
    mismatch can say which reading this checker applied.
    """
    body_b64 = raw.get("bodyBase64")
    if body_b64 is None:
        return "", "no body"

    octets = base64.b64decode(body_b64)

    encoding = (raw.get("contentEncoding") or "").strip().lower()
    if encoding in ("gzip", "x-gzip"):
        octets = gzip.decompress(octets)
    elif encoding == "deflate":
        octets = zlib.decompress(octets)
    elif encoding not in ("", "identity"):
        raise ValueError(f"unsupported Content-Encoding: {encoding}")

    content_type = raw.get("contentType")

    if not _is_json(content_type):
        # Not JSON: the text canonicalizes the decoded characters as text.
        charset = _charset_from_content_type(content_type)
        text = octets.decode(charset)
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return digest, f"text decoded as {charset}, re-encoded UTF-8"

    # JSON: try to decode into a value. If a key is duplicated (also after
    # unescaping), the value is not canonicalizable and the text says the
    # decoded bytes are hashed instead.
    try:
        text = octets.decode(_charset_from_content_type(content_type))
    except UnicodeDecodeError:
        digest = hashlib.sha256(octets).hexdigest()
        return digest, "JSON bytes not decodable; hashed as received octets"

    try:
        value = json.loads(text, object_pairs_hook=_reject_duplicates)
    except _DuplicateKey:
        digest = hashlib.sha256(octets).hexdigest()
        return digest, "duplicate key after unescaping; hashed decoded bytes without canonicalization"

    canonical = jcs_serialize(value)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest, "RFC 8785 canonical form, then SHA-256"


# --------------------------------------------------------------------------
# Vector checking
# --------------------------------------------------------------------------


def check_one(vec: dict) -> dict:
    """Check one known-answer file. Returns a result record."""
    vid = vec.get("id", "<unnamed>")
    expected = vec.get("expected", {}).get("outcome", "PASS")
    answers = vec.get("input", {}).get("known_answers", [])
    results = []

    for ka in answers:
        raw = ka.get("raw", {})
        observed = ka.get("observed", {})

        for field, recorded in observed.items():
            if field == "query":
                computed = canonical_query(raw.get("query", ""))
                reading = "RFC 3986: arrival order, & only, decode then re-encode, + stays +"
            elif field == "body_sha256":
                computed, reading = canonical_body(raw)
            else:
                results.append(
                    {
                        "field": field,
                        "computed": None,
                        "recorded": recorded,
                        "equal": True,
                        "reading": "unknown field, not checked by this implementation",
                        "skipped": True,
                    }
                )
                continue

            equal = computed == recorded
            results.append(
                {
                    "field": field,
                    "computed": computed,
                    "recorded": recorded,
                    "equal": equal,
                    "reading": reading,
                }
            )

    checked = [r for r in results if not r.get("skipped")]
    all_equal = all(r["equal"] for r in checked) and bool(checked)

    if expected == "PASS":
        passed = all_equal
        verdict = "PASS" if passed else "MISMATCH"
    elif expected == "FAIL":
        passed = not all_equal
        verdict = "PASS" if passed else "MISMATCH"
    else:
        passed = False
        verdict = f"UNKNOWN_EXPECTATION({expected})"

    return {
        "id": vid,
        "expected": expected,
        "verdict": verdict,
        "passed": passed,
        "fields": results,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__ or "usage: verify_known_answers.py <directory> [--verbose] [--json]")
        return 2

    directory = Path(argv[1])
    verbose = "--verbose" in argv
    as_json = "--json" in argv

    files = sorted(directory.glob("known-answer-*.json"))
    if not files:
        # Convenience: the vectors ship beside this script in vectors/.
        fallback = directory / "vectors"
        files = sorted(fallback.glob("known-answer-*.json"))
        if files:
            directory = fallback
    if not files:
        print(f"no known-answer-*.json files in {directory}", file=sys.stderr)
        return 2

    records = []
    for path in files:
        try:
            vec = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001 - report and continue
            records.append(
                {
                    "id": path.name,
                    "expected": "?",
                    "verdict": f"UNREADABLE({exc})",
                    "passed": False,
                    "fields": [],
                }
            )
            continue
        records.append(check_one(vec))

    if as_json:
        print(json.dumps(records, indent=2, ensure_ascii=False))
    else:
        for rec in records:
            mark = "ok  " if rec["passed"] else "FAIL"
            print(f"{mark} {rec['verdict']:<10} {rec['id']}  (expected {rec['expected']})")
            if not rec["passed"] or verbose:
                for f in rec["fields"]:
                    if f.get("skipped"):
                        print(f"       - {f['field']}: not checked ({f['reading']})")
                        continue
                    status = "equal" if f["equal"] else "DIFFERS"
                    print(f"       - {f['field']}: {status}")
                    print(f"         recorded: {f['recorded']}")
                    print(f"         computed: {f['computed']}")
                    print(f"         reading : {f['reading']}")

    failed = [r for r in records if not r["passed"]]
    print()
    print(f"{len(records) - len(failed)}/{len(records)} files behaved as expected")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
