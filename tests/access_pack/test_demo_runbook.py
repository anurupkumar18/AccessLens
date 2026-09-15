"""Check that DEMO_RUNBOOK.md still describes the pack that actually exists.

The runbook is the document read under pressure, three minutes before a demo,
often by someone who did not write it. Every concrete thing it names -- an asset
id, a hotspot, a model node, a file path, a fallback command, a measured number
-- is a claim that can go stale the moment the deck changes. A stale runbook
fails at the worst possible moment and in the most embarrassing way: reading out
a number that is no longer true, or running a fallback command that no longer
resolves.

Nothing else checks this. `validate_pack.py` checks the pack against itself;
this checks the prose against the pack.

Run:  python3 -m unittest discover -s tests/access_pack
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PACK_ROOT = REPO_ROOT / "packages" / "access-packs" / "bio-cell-demo"
RUNBOOK = REPO_ROOT / "docs" / "DEMO_RUNBOOK.md"
sys.path.insert(0, str(PACK_ROOT / "tools"))

import glb  # noqa: E402
import imagehash  # noqa: E402

PACK = json.loads((PACK_ROOT / "pack.json").read_text(encoding="utf-8"))
TEXT = RUNBOOK.read_text(encoding="utf-8")
TICKED = set(re.findall(r"`([^`\n]+)`", TEXT))

ASSET_IDS = {asset["assetId"] for asset in PACK["assets"]}
REGION_IDS = {r["regionId"] for a in PACK["assets"] for r in a["regions"]}
HOTSPOT_IDS = {h["hotspotId"] for a in PACK["assets"] for h in a["arScene"]["hotspots"]}
NODE_NAMES = set(glb.node_names(PACK_ROOT / "models" / "cell.glb"))
CAMERAS = set(PACK["arCameras"])
SCENARIOS = {p.stem for p in (PACK_ROOT / "fixtures").glob("*.json")}


class RunbookNamesRealThings(unittest.TestCase):
    def test_every_slide_it_names_is_a_reviewed_asset(self):
        for asset_id in set(re.findall(r"\bcell-slide-\d+\b", TEXT)):
            self.assertIn(asset_id, ASSET_IDS)

    def test_every_hotspot_it_names_exists(self):
        for hotspot in {t for t in TICKED if ":" in t and t.startswith("cell-slide-")}:
            self.assertIn(hotspot, HOTSPOT_IDS)

    def test_every_scenario_it_names_has_a_fixture(self):
        """The fallback table is the demo's parachute; each row must resolve."""
        named = {t for t in TICKED if t in SCENARIOS or re.fullmatch(r"[a-z]+(-[a-z]+)+", t)}
        # Only judge tokens that look like scenario slugs and are used as such.
        for token in named:
            if token in SCENARIOS:
                continue
            if f"--scenario {token}" in TEXT or f"| `{token}` |" in TEXT:
                self.fail(f"runbook names scenario '{token}', which has no fixture")

    def test_the_fallback_table_covers_every_scenario(self):
        """A scenario with no row is a rehearsed failure path with no parachute."""
        for scenario in SCENARIOS:
            self.assertIn(f"`{scenario}`", TEXT, f"{scenario} has no fallback row")

    def test_labelled_references_resolve(self):
        """Parse the runbook's own labels rather than guessing from spelling.

        The runbook writes the demo beat out as "region `x`, hotspot `y`, AR node
        `Z`, camera `c`". Reading those labels is exact. An earlier version of
        this test classified every capitalized backticked word as a model node,
        which would have failed the moment someone wrote `Pause` in the prose --
        a test that fails for the wrong reason is worse than no test.
        """
        labels = {
            "region": REGION_IDS,
            "hotspot": HOTSPOT_IDS,
            "AR node": NODE_NAMES,
            "camera": CAMERAS,
        }
        found = 0
        for label, valid in labels.items():
            # `\s+`, not a space: the runbook wraps, and "camera\n`x`" was
            # silently matching nothing, so cameras went unchecked entirely.
            for value in re.findall(rf"{label}\s+`([^`]+)`", TEXT):
                found += 1
                self.assertIn(value, valid, f"runbook names {label} '{value}', which does not exist")
        self.assertGreater(found, 0, "the runbook no longer spells out the demo beat")

    def test_every_file_path_it_names_exists(self):
        for token in TICKED:
            if "/" not in token or " " in token:
                continue
            candidate = token.split("#")[0]
            if not (REPO_ROOT / candidate).exists() and not (PACK_ROOT / candidate).exists():
                self.fail(f"runbook names path '{token}', which does not exist")

    def test_the_bare_pack_files_it_names_exist(self):
        for token in TICKED & {"pack.json", "PROVENANCE.md", "README.md"}:
            self.assertTrue((PACK_ROOT / token).exists(), token)


class RunbookNumbersAreStillTrue(unittest.TestCase):
    """The runbook states measured numbers out loud. Recompute them."""

    def test_the_unmatched_slide_claim_matches_measurement(self):
        claim = re.search(
            r"it sits (\d+) bits from its nearest reviewed slide against a ceiling of\s+"
            r"(\d+), and clears the margin rule by (\d+) bits against a required (\d+)",
            TEXT,
        )
        self.assertIsNotNone(claim, "the unmatched-slide claim is no longer in the runbook")
        stated_distance, stated_ceiling, stated_margin, stated_required = (
            int(value) for value in claim.groups()
        )

        fingerprints = {a["assetId"]: a["fingerprint"] for a in PACK["assets"]}
        unapproved = imagehash.fingerprint(
            PACK_ROOT / "demo-assets" / "unapproved-photosynthesis.png"
        )
        ranked = sorted(
            (imagehash.hamming_distance(unapproved, value), key)
            for key, value in fingerprints.items()
        )
        actual_distance = ranked[0][0]
        actual_margin = ranked[1][0] - actual_distance

        self.assertEqual(stated_distance, actual_distance, "stated distance is stale")
        self.assertEqual(stated_margin, actual_margin, "stated margin is stale")
        self.assertEqual(stated_ceiling, PACK["matching"]["maxHammingDistance"])
        self.assertEqual(stated_required, PACK["matching"]["minMargin"])

    def test_the_claim_still_describes_a_rejection(self):
        """If the numbers ever stop meaning 'rejected', the beat is a lie."""
        fingerprints = {a["assetId"]: a["fingerprint"] for a in PACK["assets"]}
        unapproved = imagehash.fingerprint(
            PACK_ROOT / "demo-assets" / "unapproved-photosynthesis.png"
        )
        ranked = sorted(
            (imagehash.hamming_distance(unapproved, value), key)
            for key, value in fingerprints.items()
        )
        nearest, margin = ranked[0][0], ranked[1][0] - ranked[0][0]
        self.assertGreater(nearest, PACK["matching"]["maxHammingDistance"])
        self.assertLess(margin, PACK["matching"]["minMargin"])


class RunbookCommandsResolve(unittest.TestCase):
    def test_every_simulator_invocation_names_a_real_scenario(self):
        for scenario in re.findall(r"--scenario\s+([a-z-]+)", TEXT):
            if scenario == "<name>":
                continue
            self.assertIn(scenario, SCENARIOS, f"--scenario {scenario} has no fixture")

    def test_every_simulator_flag_the_runbook_uses_is_accepted(self):
        """Check the flags the runbook actually uses, not a known-good list.

        The first version of this filtered to four flags it already knew were
        valid, so an invented `--tempo` passed. Mutation testing caught it. The
        direction matters: extract from the prose, validate against the tool.
        """
        simulator = PACK_ROOT / "tools" / "simulate_events.py"
        self.assertTrue(simulator.exists())
        accepted = set(re.findall(r'add_argument\(\s*"(--[a-z-]+)"', simulator.read_text(encoding="utf-8")))
        self.assertTrue(accepted, "could not read the simulator's flags")

        used = {
            flag
            for block in re.findall(r"simulate_events\.py(.*?)(?:```|\n\n)", TEXT, re.S)
            for flag in re.findall(r"(--[a-z-]{2,})", block)
        }
        self.assertTrue(used, "the runbook no longer shows a simulator command")
        for flag in used:
            self.assertIn(flag, accepted, f"runbook uses {flag}, which the simulator does not accept")


if __name__ == "__main__":
    unittest.main()
