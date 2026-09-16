"""The conformance checker's `maxLength` rule, proven able to fail.

Part 6 caps a course-library quote at 300 characters in
`packages/contracts/access-pack.schema.json` (relay T-25, T-30), so the Python
reimplementation of JSON Schema in `check_contract_conformance.py` had to learn
`maxLength`. RL-014's lesson applies: a check that cannot go red is worth
nothing, so every rule here is exercised against a mutation and against a
control that must stay green.

Run:  python3 -m unittest discover -s tests/access_pack -t .
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLS = REPO_ROOT / "packages" / "access-packs" / "bio-cell-demo" / "tools"
sys.path.insert(0, str(TOOLS))

import check_contract_conformance as conformance  # noqa: E402


QUOTE_SCHEMA = {"type": "string", "minLength": 1, "maxLength": 300}


class MaxLengthRule(unittest.TestCase):
    def test_a_quote_within_the_cap_is_clean(self):
        """The control. Without it, a rule that rejects everything passes every other test."""
        self.assertEqual(conformance._check("q" * 300, QUOTE_SCHEMA, "quote"), [])

    def test_a_quote_one_character_past_the_cap_is_reported(self):
        gaps = conformance._check("q" * 301, QUOTE_SCHEMA, "quote")
        self.assertIn(("too-long", "quote"), gaps)

    def test_the_cap_does_not_swallow_the_minimum(self):
        gaps = conformance._check("", QUOTE_SCHEMA, "quote")
        self.assertIn(("too-short", "quote"), gaps)
        self.assertNotIn(("too-long", "quote"), gaps)

    def test_a_schema_with_no_cap_never_reports_too_long(self):
        gaps = conformance._check("q" * 10_000, {"type": "string"}, "quote")
        self.assertEqual(gaps, [])

    def test_maxlength_is_a_supported_keyword_so_the_guard_does_not_stop(self):
        """The unsupported-keyword guard is the reason RL-005 found anything.
        It must know about maxLength rather than be bypassed."""
        self.assertIn("maxLength", conformance.SUPPORTED_KEYWORDS)
        conformance._assert_supported(
            conformance.load_schema("access-pack.schema.json"), "AccessPack"
        )


class ThePackContractCarriesTheCap(unittest.TestCase):
    def test_the_published_schema_caps_a_reference_quote_at_300(self):
        schema = conformance.load_schema("access-pack.schema.json")
        quote = (
            schema["properties"]["assets"]["items"]["properties"]["references"]
            ["items"]["properties"]["quote"]
        )
        self.assertEqual(quote["maxLength"], 300)

    def test_an_over_long_quote_fails_the_real_pack_schema(self):
        schema = conformance.load_schema("access-pack.schema.json")
        pack = {
            "schemaVersion": "1.0", "packId": "p", "version": 1, "title": "t",
            "assets": [{
                "assetId": "a", "fingerprint": "f", "title": "t", "readingOrder": [],
                "regions": [],
                "references": [{"docId": "d", "title": "t", "page": 1, "quote": "q" * 301}],
            }],
        }
        gaps = conformance._check(pack, schema, "")
        self.assertTrue(any(kind == "too-long" for kind, _ in gaps), gaps)

    def test_the_same_pack_with_a_legal_quote_is_clean(self):
        schema = conformance.load_schema("access-pack.schema.json")
        pack = {
            "schemaVersion": "1.0", "packId": "p", "version": 1, "title": "t",
            "assets": [{
                "assetId": "a", "fingerprint": "f", "title": "t", "readingOrder": [],
                "regions": [],
                "references": [{"docId": "d", "title": "t", "page": 1, "quote": "q" * 300}],
            }],
        }
        self.assertEqual(conformance._check(pack, schema, ""), [])


if __name__ == "__main__":
    unittest.main()
