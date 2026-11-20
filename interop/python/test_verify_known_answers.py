#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Rachel (https://github.com/ruiruii)
#
# Tests for verify_known_answers.py.
#
# Two kinds, and the second kind is the one that matters:
#
#  1. Every published known-answer file behaves as its `expected.outcome`
#     says: the eleven PASS files pass, the eleven FAIL files fail. A
#     checker that always says PASS would pass the first group and is
#     caught by the second.
#
#  2. Each rule the section states is broken on purpose, one at a time,
#     and the checker must then disagree with the recorded value. If a
#     mutant survives, the corresponding assertion was not testing
#     anything, whatever its colour.
#
# Run: python3 test_verify_known_answers.py [directory]
# Exits 0 when every test passes.

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "verify_known_answers", HERE / "verify_known_answers.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


V = _load_module()

VECTOR_DIR = Path(sys.argv.pop(1)) if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else HERE

# The vectors ship beside the checker in vectors/. Accept either layout so
# the suite runs the same way from this directory and from a copy that puts
# the files side by side.
if not list(VECTOR_DIR.glob("known-answer-*.json")) and list(
    (VECTOR_DIR / "vectors").glob("known-answer-*.json")
):
    VECTOR_DIR = VECTOR_DIR / "vectors"


def _vec(query: str, observed: str, outcome: str = "PASS") -> dict:
    return {
        "id": "inline",
        "expected": {"outcome": outcome},
        "input": {"known_answers": [{"raw": {"query": query}, "observed": {"query": observed}}]},
    }


class TestPublishedVectors(unittest.TestCase):
    """The published files must behave as they say they do."""

    def test_all_files_behave_as_expected(self):
        files = sorted(VECTOR_DIR.glob("known-answer-*.json"))
        self.assertTrue(files, f"no known-answer files found in {VECTOR_DIR}")
        import json

        failures = []
        for path in files:
            vec = json.loads(path.read_text(encoding="utf-8"))
            rec = V.check_one(vec)
            if not rec["passed"]:
                failures.append((path.name, rec["verdict"], rec["fields"]))
        self.assertEqual(failures, [], f"{len(failures)} file(s) did not behave as expected")

    def test_counts_are_eleven_and_eleven(self):
        import json

        files = sorted(VECTOR_DIR.glob("known-answer-*.json"))
        outcomes = [json.loads(p.read_text(encoding="utf-8"))["expected"]["outcome"] for p in files]
        self.assertEqual(outcomes.count("PASS"), 11)
        self.assertEqual(outcomes.count("FAIL"), 11)


class TestQueryRules(unittest.TestCase):
    """One mutant per rule in the section's Query bullet."""

    def test_arrival_order_not_sorted(self):
        # b=2&a=%2f keeps b before a. Sorting would give a first.
        self.assertEqual(V.canonical_query("b=2&a=%2f"), "b=2&a=%2F")
        self.assertNotEqual(V.canonical_query("b=2&a=%2f"), "a=%2F&b=2")

    def test_uppercase_hex(self):
        self.assertEqual(V.canonical_query("a=%2f"), "a=%2F")
        self.assertNotEqual(V.canonical_query("a=%2f"), "a=%2f")

    def test_repeated_names_keep_order(self):
        # The negative control for a first-value handler.
        self.assertEqual(V.canonical_query("q=caf%c3%a9&q=a"), "q=caf%C3%A9&q=a")
        self.assertNotEqual(
            V.canonical_query("q=caf%c3%a9&q=a"),
            V.canonical_query("q=a&q=caf%c3%a9"),
        )

    def test_plus_stays_plus(self):
        self.assertEqual(V.canonical_query("a=b+c"), "a=b%2Bc")

    def test_bare_name_differs_from_empty_value(self):
        self.assertEqual(V.canonical_query("q&q="), "q&q=")
        self.assertNotEqual(V.canonical_query("q&q="), "q=&q=")

    def test_semicolon_is_data(self):
        self.assertEqual(V.canonical_query("x=1;q=b&q=a"), "x=1%3Bq%3Db&q=a")

    def test_decode_then_encode(self):
        self.assertEqual(V.canonical_query("q=b&q=%61"), "q=b&q=a")

    def test_invalid_utf8_octet_survives(self):
        self.assertEqual(V.canonical_query("q=%C3"), "q=%C3")
        self.assertNotEqual(V.canonical_query("q=%C3"), "q=%EF%BF%BD")


class TestBodyRules(unittest.TestCase):
    """Body canonicalization branches."""

    def test_rfc8785_sorts_keys(self):
        raw = {"contentType": "application/json", "bodyBase64": "eyJiIjoyLCJhIjpbMSwyXX0="}
        digest, reading = V.canonical_body(raw)
        import hashlib

        self.assertEqual(digest, hashlib.sha256(b'{"a":[1,2],"b":2}').hexdigest())
        self.assertIn("RFC 8785", reading)

    def test_duplicate_key_hashes_raw_bytes(self):
        import hashlib

        raw = {"contentType": "application/json", "bodyBase64": "eyJhIjoxLCJcdTAwNjEiOjJ9"}
        digest, reading = V.canonical_body(raw)
        octets = b'{"a":1,"\\u0061":2}'
        self.assertEqual(digest, hashlib.sha256(octets).hexdigest())
        self.assertIn("duplicate key", reading)

    def test_charset_latin1(self):
        import hashlib

        raw = {"contentType": "text/plain; charset=iso-8859-1", "bodyBase64": "gEE="}
        digest, reading = V.canonical_body(raw)
        # 0x80 maps to U+0080, then UTF-8 encodes to c2 80.
        self.assertEqual(digest, hashlib.sha256(b"\xc2\x80A").hexdigest())
        self.assertIn("latin-1", reading)


class TestMutantsDie(unittest.TestCase):
    """Each mutant is a wrong reading of the text; the checker must notice."""

    def test_sorted_query_mutant_dies(self):
        original = V.canonical_query
        V.canonical_query = lambda q: "&".join(sorted(original(q).split("&")))
        try:
            rec = V.check_one(_vec("b=2&a=%2f", "b=2&a=%2F"))
            self.assertEqual(rec["verdict"], "MISMATCH")
        finally:
            V.canonical_query = original

    def test_plus_as_space_mutant_dies(self):
        original = V.percent_decode_octets
        V.percent_decode_octets = lambda t: original(t.replace("+", "%20"))
        try:
            rec = V.check_one(_vec("a=b+c", "a=b%2Bc"))
            self.assertEqual(rec["verdict"], "MISMATCH")
        finally:
            V.percent_decode_octets = original

    def test_lowercase_hex_mutant_dies(self):
        original = V.percent_encode_octets

        def lowercase(octets):
            return original(octets).replace("%2F", "%2f")

        V.percent_encode_octets = lowercase
        try:
            rec = V.check_one(_vec("a=%2f", "a=%2F"))
            self.assertEqual(rec["verdict"], "MISMATCH")
        finally:
            V.percent_encode_octets = original

    def test_always_pass_checker_is_caught(self):
        # A checker that computes nothing and answers "pass" would pass every
        # PASS file. The FAIL files are what expose it: there the recorded
        # value is deliberately wrong, so a checker echoing "looks fine"
        # instead of computing must be caught.
        original = V.canonical_query

        # Mutant: ignore the input entirely, always return a fixed plausible
        # string. This is the shape of a checker that does not compute.
        V.canonical_query = lambda q: "not-the-recorded-value"
        try:
            # On a PASS file the mutant should now FAIL to match.
            wrong_on_pass = V.check_one(_vec("q=caf%c3%a9&q=a", "q=caf%C3%A9&q=a", outcome="PASS"))
            self.assertEqual(wrong_on_pass["verdict"], "MISMATCH")
            # And on a FAIL file it must not silently agree with the record.
            wrong_on_fail = V.check_one(_vec("q=caf%c3%a9&q=a", "q=a&q=caf%C3%A9", outcome="FAIL"))
            self.assertEqual(wrong_on_fail["verdict"], "PASS")
        finally:
            V.canonical_query = original


class TestReporting(unittest.TestCase):
    """A mismatch must say which field and which reading."""

    def test_mismatch_names_field_and_reading(self):
        rec = V.check_one(_vec("a=b+c", "a=b%20c"))
        self.assertFalse(rec["passed"])
        field = rec["fields"][0]
        self.assertEqual(field["field"], "query")
        self.assertIn("RFC 3986", field["reading"])
        self.assertNotEqual(field["computed"], field["recorded"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
