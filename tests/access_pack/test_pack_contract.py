"""Guardrail suite for the bio-cell-demo Access Pack and its fixtures.

Standard library only, so it runs in the existing documentation CI job before
any JavaScript workspace exists. Covers implementation-plan tasks A14 (failure
scenarios) and the content half of Part 5 in `docs/PARALLEL_WORKSTREAMS.md`.

The suite asserts three things the rest of the build depends on:

1. `pack.json` is publishable -- fingerprints match the PNGs on disk, every
   region has an AR hotspot pointing at a real model node, provenance is
   recorded.
2. The validator actually fails when the pack is wrong. A green validator that
   cannot go red is worth nothing, so each rule is tested against a mutation.
3. Every fixture is consistent with the pack, and every negative fixture trips
   exactly the contract rule it claims to.

Run:  python3 -m unittest discover -s tests/access_pack -t .
"""

from __future__ import annotations

import html
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PACK_ROOT = REPO_ROOT / "packages" / "access-packs" / "bio-cell-demo"
TOOLS = PACK_ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import glb  # noqa: E402
import imagehash  # noqa: E402
import check_contract_conformance as conformance  # noqa: E402
import generate_review_sheet  # noqa: E402
import reference_event_check as contract  # noqa: E402
import validate_pack  # noqa: E402

PACK = json.loads((PACK_ROOT / "pack.json").read_text(encoding="utf-8"))
FIXTURES = PACK_ROOT / "fixtures"


class PackValidates(unittest.TestCase):
    def test_pack_passes_every_check(self):
        self.assertEqual(validate_pack.validate(), [])

    def test_every_region_has_exactly_one_hotspot(self):
        for asset in PACK["assets"]:
            regions = [region["regionId"] for region in asset["regions"]]
            hotspots = [hotspot["regionId"] for hotspot in asset["arScene"]["hotspots"]]
            self.assertCountEqual(regions, hotspots, asset["assetId"])

    def test_every_hotspot_camera_frames_its_node(self):
        """Measured, not assumed.

        Tightest framing today is the vacuole on cell-slide-05, using 15.6 of
        the 17.5 degrees available — 89% of the half field of view. That is
        correct but has little room, so widening `recycling-closeup` or moving
        the vacuole is the kind of edit this test exists to catch.
        """
        self.assertEqual(validate_pack.check_ar_framing(PACK), [])

    def test_every_hotspot_names_a_real_model_node(self):
        nodes = set(glb.node_names(PACK_ROOT / "models" / "cell.glb"))
        for asset in PACK["assets"]:
            for hotspot in asset["arScene"]["hotspots"]:
                self.assertIn(hotspot["nodeName"], nodes, hotspot["hotspotId"])

    def test_hotspot_ids_are_unique_pack_wide(self):
        ids = [h["hotspotId"] for a in PACK["assets"] for h in a["arScene"]["hotspots"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_fingerprints_match_the_slides_on_disk(self):
        for asset in PACK["assets"]:
            recomputed = imagehash.fingerprint(PACK_ROOT / asset["mediaUri"])
            self.assertEqual(asset["fingerprint"], recomputed, asset["assetId"])

    def test_reviewed_slides_are_far_enough_apart_to_match(self):
        margin = PACK["matching"]["minMargin"]
        fingerprints = {a["assetId"]: a["fingerprint"] for a in PACK["assets"]}
        ids = sorted(fingerprints)
        for index, left in enumerate(ids):
            for right in ids[index + 1 :]:
                distance = imagehash.hamming_distance(fingerprints[left], fingerprints[right])
                self.assertGreaterEqual(distance, 2 * margin, f"{left} vs {right}")

    def test_unapproved_slide_is_rejected_by_the_matching_policy(self):
        """The demo's Unmatched beat is only honest if this actually fails to match."""
        ceiling = PACK["matching"]["maxHammingDistance"]
        margin = PACK["matching"]["minMargin"]
        fingerprints = {a["assetId"]: a["fingerprint"] for a in PACK["assets"]}
        unapproved = imagehash.fingerprint(PACK_ROOT / "demo-assets" / "unapproved-photosynthesis.png")
        ranked = sorted(
            (imagehash.hamming_distance(unapproved, value), key) for key, value in fingerprints.items()
        )
        nearest = ranked[0][0]
        self.assertGreater(nearest, ceiling, "unapproved slide came inside the match ceiling")
        self.assertLess(ranked[1][0] - nearest, margin, "unapproved slide cleared the margin rule")

    def test_pack_claims_no_review_it_has_not_had(self):
        review = PACK["review"]
        if review.get("externalSubjectMatterReview") is False:
            self.assertIn("A15", review["notes"])


class ValidatorCanFail(unittest.TestCase):
    """Each rule is checked against a mutation, so the validator cannot rot green."""

    # One copy for the whole class, not one per test. The fingerprint cache in
    # imagehash is keyed by path, so a fresh temp directory per test made every
    # validate() rehash five slides from scratch. That grew the suite past a
    # minute as mutation cases were added, and a suite that slow stops being run.
    @classmethod
    def setUpClass(cls):
        cls.workspace = Path(tempfile.mkdtemp())
        cls.copy = cls.workspace / "bio-cell-demo"
        shutil.copytree(PACK_ROOT, cls.copy)
        cls.pristine = {
            name: (cls.copy / name).read_text(encoding="utf-8")
            for name in ("pack.json", "PROVENANCE.md")
        }

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.workspace, ignore_errors=True)

    def setUp(self):
        # Restore the files a test may mutate, so sharing the copy stays safe.
        for name, text in self.pristine.items():
            (self.copy / name).write_text(text, encoding="utf-8")
        self._original_root = validate_pack.PACK_ROOT

    def _validate_with(self, mutate) -> list[str]:
        pack = json.loads((self.copy / "pack.json").read_text(encoding="utf-8"))
        mutate(pack)
        (self.copy / "pack.json").write_text(json.dumps(pack, indent=2), encoding="utf-8")
        validate_pack.PACK_ROOT = self.copy
        validate_pack.PACK_FILE = self.copy / "pack.json"
        validate_pack.PROVENANCE = self.copy / "PROVENANCE.md"
        validate_pack.DEMO_ASSETS = self.copy / "demo-assets"
        try:
            return validate_pack.validate()
        finally:
            validate_pack.PACK_ROOT = self._original_root
            validate_pack.PACK_FILE = self._original_root / "pack.json"
            validate_pack.PROVENANCE = self._original_root / "PROVENANCE.md"
            validate_pack.DEMO_ASSETS = self._original_root / "demo-assets"

    def _assert_flags(self, mutate, needle: str):
        errors = self._validate_with(mutate)
        self.assertTrue(
            any(needle in error for error in errors),
            f"expected an error containing {needle!r}, got {errors}",
        )

    def test_unmutated_copy_still_passes(self):
        self.assertEqual(self._validate_with(lambda pack: None), [])

    def test_stale_fingerprint_is_caught(self):
        def mutate(pack):
            pack["assets"][0]["fingerprint"] = "dhash12:" + "0" * 33

        self._assert_flags(mutate, "does not match")

    def test_hotspot_on_a_missing_model_node_is_caught(self):
        def mutate(pack):
            pack["assets"][0]["arScene"]["hotspots"][0]["nodeName"] = "Chloroplast"

        self._assert_flags(mutate, "is not a node in")

    def test_region_missing_from_reading_order_is_caught(self):
        def mutate(pack):
            pack["assets"][0]["readingOrder"].remove("nucleus")

        self._assert_flags(mutate, "missing from readingOrder")

    def test_region_without_a_hotspot_is_caught(self):
        def mutate(pack):
            pack["assets"][0]["arScene"]["hotspots"].pop()

        self._assert_flags(mutate, "has no AR hotspot")

    def test_out_of_range_bounds_are_caught(self):
        def mutate(pack):
            pack["assets"][0]["regions"][0]["bounds"]["width"] = 1.4

        self._assert_flags(mutate, "normalized between 0 and 1")

    def test_bounds_running_off_the_slide_are_caught(self):
        def mutate(pack):
            pack["assets"][0]["regions"][0]["bounds"]["x"] = 0.9
            pack["assets"][0]["regions"][0]["bounds"]["width"] = 0.5

        self._assert_flags(mutate, "past the right edge")

    def test_prohibited_field_is_caught(self):
        def mutate(pack):
            pack["assets"][0]["regions"][0]["masteryEstimate"] = 0.4

        self._assert_flags(mutate, "prohibited field name")

    def test_unknown_camera_reference_is_caught(self):
        def mutate(pack):
            pack["assets"][0]["arScene"]["defaultCamera"] = "does-not-exist"

        self._assert_flags(mutate, "is not in arCameras")

    def test_describing_unmatched_content_is_caught(self):
        def mutate(pack):
            pack["matching"]["onNoMatch"] = "best-guess"

        self._assert_flags(mutate, "source.unmatched")

    def test_missing_provenance_entry_is_caught(self):
        provenance = self.copy / "PROVENANCE.md"
        provenance.write_text(
            provenance.read_text(encoding="utf-8").replace("slides/cell-slide-01.png", "slides/removed.png"),
            encoding="utf-8",
        )
        self._assert_flags(lambda pack: None, "does not record the source and licence")

    def test_a_camera_aimed_away_from_its_node_is_caught(self):
        """The bug this exists for: ids all resolve, but the view is empty."""
        def mutate(pack):
            pack["arCameras"]["mitochondrion-closeup"]["target"] = [-0.9, -0.9, 0.0]

        self._assert_flags(mutate, "not fully inside camera")

    def test_too_narrow_a_field_of_view_is_caught(self):
        def mutate(pack):
            pack["arCameras"]["cell-overview"]["fov"] = 11

        self._assert_flags(mutate, "not fully inside camera")

    def test_a_camera_inside_its_own_node_is_caught(self):
        def mutate(pack):
            pack["arCameras"]["mitochondrion-closeup"]["position"] = [0.38, 0.16, 0.1]

        errors = self._validate_with(mutate)
        self.assertTrue(
            any("sits on its own target" in e or "is inside node" in e for e in errors), errors
        )

    def test_near_duplicate_slides_are_caught(self):
        def mutate(pack):
            pack["assets"][1]["fingerprint"] = pack["assets"][0]["fingerprint"]

        errors = self._validate_with(mutate)
        self.assertTrue(any("bits apart" in error for error in errors), errors)


class FixturesMatchThePack(unittest.TestCase):
    def _scenarios(self):
        for path in sorted(FIXTURES.glob("*.json")):
            yield path.stem, json.loads(path.read_text(encoding="utf-8"))

    def test_scenarios_exist_for_every_required_failure_path(self):
        """A14 names the failure paths the demo has to survive."""
        required = {
            "happy-path",
            "unmatched-and-correction",
            "stale-and-reordered",
            "pause-resume-stop",
            "reconnect-latest-state",
            "captions",
        }
        self.assertEqual(required, {name for name, _ in self._scenarios()})

    def test_every_event_type_is_allowlisted(self):
        for name, fixture in self._scenarios():
            for event in fixture["events"]:
                self.assertIn(event["type"], contract.ALLOWED_EVENT_TYPES, name)

    def test_every_event_carries_only_contract_fields(self):
        for name, fixture in self._scenarios():
            for event in fixture["events"]:
                unknown = set(event) - contract.KNOWN_FIELDS
                self.assertEqual(set(), unknown, f"{name}: {unknown}")

    def test_every_referenced_asset_region_and_hotspot_exists(self):
        assets = {asset["assetId"]: asset for asset in PACK["assets"]}
        for name, fixture in self._scenarios():
            for event in fixture["events"]:
                asset_id = event.get("assetId")
                if asset_id is None:
                    continue
                self.assertIn(asset_id, assets, name)
                region_id = event.get("regionId")
                if region_id is not None:
                    self.assertIn(
                        region_id, {r["regionId"] for r in assets[asset_id]["regions"]}, name
                    )
                hotspot_id = (event.get("arState") or {}).get("hotspotId")
                if hotspot_id is not None:
                    self.assertIn(
                        hotspot_id,
                        {h["hotspotId"] for h in assets[asset_id]["arScene"]["hotspots"]},
                        name,
                    )

    def test_pointer_coordinates_are_normalized(self):
        for name, fixture in self._scenarios():
            for event in fixture["events"]:
                pointer = event.get("pointer")
                if pointer is None:
                    continue
                for axis in ("x", "y"):
                    self.assertGreaterEqual(pointer[axis], 0.0, name)
                    self.assertLessEqual(pointer[axis], 1.0, name)

    def test_ordered_scenarios_have_strictly_increasing_sequences(self):
        for name, fixture in self._scenarios():
            if name == "stale-and-reordered":
                continue  # Out-of-order delivery is this fixture's whole purpose.
            # A reconnect redelivers the latest event on purpose; that duplicate
            # is the caught-up state, not a stream ordering violation.
            redelivered = set(fixture.get("redeliveredEventIndices", []))
            sequences = [
                event["sequence"]
                for index, event in enumerate(fixture["events"])
                if index not in redelivered
            ]
            self.assertEqual(sequences, sorted(set(sequences)), name)

    def test_redelivered_events_are_identical_to_the_original(self):
        """Reconnect catch-up must be a byte-identical replay.

        A redelivery that differs from the original -- even by a marker field --
        is a second event, and re-applying it can no longer be assumed a no-op.
        """
        for name, fixture in self._scenarios():
            events = fixture["events"]
            for index in fixture.get("redeliveredEventIndices", []):
                original = next(
                    (e for e in events[:index] if e["sequence"] == events[index]["sequence"]),
                    None,
                )
                self.assertIsNotNone(original, f"{name}: redelivery {index} replays nothing")
                self.assertEqual(original, events[index], f"{name}: redelivery {index} differs")

    def test_no_event_carries_transport_metadata(self):
        """Redelivery is a fact about the transport, not about the moment taught."""
        for name, fixture in self._scenarios():
            for event in fixture["events"]:
                for field in ("redelivery", "redelivered", "retry", "attempt"):
                    self.assertNotIn(field, event, name)

    def test_asset_changed_carries_no_ar_state(self):
        """The shared contract forbids it, and the pack's defaultCamera covers it."""
        for name, fixture in self._scenarios():
            for event in fixture["events"]:
                if event["type"] == "asset.changed":
                    self.assertNotIn("arState", event, name)

    def test_stale_fixture_actually_goes_backwards(self):
        fixture = json.loads((FIXTURES / "stale-and-reordered.json").read_text(encoding="utf-8"))
        sequences = [event["sequence"] for event in fixture["events"]]
        self.assertNotEqual(sequences, sorted(set(sequences)))

    def test_unmatched_event_never_names_content(self):
        """Charter A9: unknown content produces an unmatched state, never a description."""
        for name, fixture in self._scenarios():
            for event in fixture["events"]:
                if event["type"] != "source.unmatched":
                    continue
                self.assertIsNone(event.get("assetId"), name)
                self.assertIsNone(event.get("regionId"), name)
                self.assertIsNone((event.get("arState") or {}).get("hotspotId"), name)

    def test_happy_path_covers_the_runbook_demo_beats(self):
        fixture = json.loads((FIXTURES / "happy-path.json").read_text(encoding="utf-8"))
        changes = [event for event in fixture["events"] if event["type"] == "asset.changed"]
        self.assertGreaterEqual(len(changes), 5, "the runbook rehearses five slide changes")
        mitochondrion = [
            event
            for event in fixture["events"]
            if event.get("regionId") == "mitochondrion"
            and event["arState"]["hotspotId"] == "cell-slide-03:mitochondrion"
        ]
        self.assertTrue(mitochondrion, "the runbook's mitochondrion beat is missing")

    def test_every_scenario_states_what_a_consumer_must_do(self):
        for name, fixture in self._scenarios():
            self.assertTrue(fixture["expectations"], name)


class NegativeFixturesAreRejected(unittest.TestCase):
    def _invalid(self):
        for path in sorted((FIXTURES / "invalid").glob("*.json")):
            yield path.stem, json.loads(path.read_text(encoding="utf-8"))

    def test_each_negative_fixture_trips_its_documented_rule(self):
        for name, fixture in self._invalid():
            broken = contract.check_event(
                fixture["event"], PACK, last_sequence=fixture["lastDeliveredSequence"]
            )
            self.assertIn(fixture["expectedRule"], broken, f"{name} -> {broken}")

    def test_each_negative_fixture_explains_itself(self):
        for name, fixture in self._invalid():
            self.assertTrue(fixture["reason"], name)
            self.assertTrue(fixture["mustBeRejected"], name)

    def test_the_valid_stream_is_accepted_by_the_same_rules(self):
        """The checker has to say yes to good events, not just no to bad ones."""
        fixture = json.loads((FIXTURES / "happy-path.json").read_text(encoding="utf-8"))
        last = 0
        for event in fixture["events"]:
            broken = contract.check_event(event, PACK, last_sequence=last)
            self.assertEqual([], broken, f"sequence {event['sequence']}: {broken}")
            last = event["sequence"]

    def test_prohibited_signals_are_rejected_whatever_they_are_called(self):
        for field in ("masteryEstimate", "attentionScore", "diagnosis", "frameData", "studentId"):
            event = {
                "schemaVersion": "1.0",
                "type": "region.changed",
                "sessionId": "s",
                "packId": PACK["packId"],
                "packVersion": PACK["version"],
                "assetId": "cell-slide-03",
                "regionId": "mitochondrion",
                "sequence": 2,
                "sentAt": "2026-09-15T15:00:00Z",
                field: "x",
            }
            self.assertIn(f"field-not-on-contract:{field}", contract.check_event(event, PACK, 1))


class ReviewSheet(unittest.TestCase):
    """A15 needs something a biology or accessibility reviewer can actually read."""

    def setUp(self):
        self.html = (PACK_ROOT / "review" / "content-review-sheet.html").read_text(encoding="utf-8")

    def test_the_checked_in_sheet_matches_the_pack(self):
        pack = json.loads((PACK_ROOT / "pack.json").read_text(encoding="utf-8"))
        self.assertEqual(generate_review_sheet.render(pack), self.html)

    def test_every_region_box_is_drawn_at_its_pack_bounds(self):
        """The boxes are the review: one drawn wrong sends a reviewer's eye astray."""
        drawn = re.findall(
            r"left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%", self.html
        )
        expected = [
            (
                region["bounds"]["x"] * 100,
                region["bounds"]["y"] * 100,
                region["bounds"]["width"] * 100,
                region["bounds"]["height"] * 100,
            )
            for asset in PACK["assets"]
            for region in asset["regions"]
        ]
        self.assertEqual(len(drawn), len(expected))
        for (dx, dy, dw, dh), (ex, ey, ew, eh) in zip(drawn, expected):
            self.assertAlmostEqual(float(dx), ex, places=3)
            self.assertAlmostEqual(float(dy), ey, places=3)
            self.assertAlmostEqual(float(dw), ew, places=3)
            self.assertAlmostEqual(float(dh), eh, places=3)

    def test_every_student_facing_sentence_appears(self):
        for asset in PACK["assets"]:
            for region in asset["regions"]:
                for text in (region["shortDescription"], region["plainLanguage"]):
                    self.assertIn(html.escape(text, quote=True), self.html, region["regionId"])

    def test_it_declares_a_charset(self):
        """Without it the em dashes in the reviewed copy render as mojibake."""
        self.assertIn('<meta charset="utf-8">', self.html)

    def test_it_says_the_content_is_not_expert_reviewed(self):
        if PACK["review"].get("externalSubjectMatterReview") is False:
            self.assertIn("has not been reviewed by a", self.html)
            self.assertIn("A15", self.html)


class ConformanceWithPart1Contracts(unittest.TestCase):
    """The pack's standing against `packages/contracts/` cannot drift unnoticed."""

    @unittest.skipUnless(conformance.CONTRACTS.exists(), "packages/contracts/ not present")
    def test_only_documented_gaps_remain(self):
        gaps, _ = conformance.collect_gaps()
        self.assertEqual(
            set(),
            gaps - conformance.EXPECTED_GAPS,
            "new incompatibility with the shared contract; see docs/PART5_CONTRACT_CONFORMANCE.md",
        )

    @unittest.skipUnless(conformance.CONTRACTS.exists(), "packages/contracts/ not present")
    def test_the_conformance_checker_can_detect_a_break(self):
        """A checker that only ever reports the same list is not checking anything."""
        schema = conformance.load_schema("live-event.schema.json")
        schema["required"] = schema["required"] + ["somethingNewlyRequired"]
        event = {
            "schemaVersion": "1.0",
            "type": "region.changed",
            "sessionId": "s",
            "packId": PACK["packId"],
            "packVersion": PACK["version"],
            "assetId": "cell-slide-03",
            "sequence": 1,
            "sentAt": "2026-09-15T15:00:00Z",
        }
        gaps = conformance.validate(event, schema, "LiveEvent")
        self.assertIn("LiveEvent:missing-required:somethingNewlyRequired", gaps)

    def test_an_unhandled_schema_keyword_raises_instead_of_passing(self):
        """The subset validator must not silently ignore a constraint it cannot apply."""
        with self.assertRaises(NotImplementedError):
            conformance.validate({}, {"type": "object", "oneOf": []}, "LiveEvent")


if __name__ == "__main__":
    unittest.main()
