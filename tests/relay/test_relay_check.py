"""Mutation tests for scripts/relay_check.py.

The reviewer's point, which is correct: this checker's entire justification is
that an unchecked guard drifts silently, and it shipped without a guard of its
own. Nine mutations were run by hand and one real bug was found that way -- an
asymmetric owner/status rule -- but none of it was committed, so nothing stops a
later "simplification" from quietly removing a check.

Each case below mutates a known-good relay document in one way and asserts the
checker reports it. `test_the_pristine_document_passes` is the control: without
it, a checker that rejected everything would pass every other test here.

Run:  python3 -m unittest discover -s tests/relay
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import relay_check  # noqa: E402

PRISTINE = (REPO_ROOT / "docs" / "CONTEXT_RELAY.md").read_text(encoding="utf-8")


def replace_cell(text: str, row_prefix: str, column: int, value: str) -> str:
    """Rewrite one cell of the table row starting with `row_prefix`.

    Mutations used to embed whole rows as string literals, which meant editing
    the relay document broke the tests for reasons that had nothing to do with
    the checker. Addressing rows by their first cell survives ordinary edits to
    the prose around them.
    """
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = relay_check._split_row(stripped)
        if cells and cells[0] == row_prefix:
            mutated = list(cells)
            mutated[column] = value
            return text.replace(line, "| " + " | ".join(mutated) + " |", 1)
    raise AssertionError(f"no table row starting with {row_prefix!r}")


def errors_for(text: str) -> list[str]:
    """Run every check the way main() does, against an in-memory document."""
    problems = relay_check.check_sections(text)
    if problems:
        return problems
    problems += relay_check.check_parts(text)
    thread_problems, thread_ids = relay_check.check_threads(text)
    problems += thread_problems
    problems += relay_check.check_log(text, thread_ids)
    return problems


class RelayCheckCatchesMutations(unittest.TestCase):
    def assert_catches(self, mutated: str, needle: str) -> None:
        self.assertNotEqual(PRISTINE, mutated, "the mutation changed nothing")
        problems = errors_for(mutated)
        self.assertTrue(
            any(needle in problem for problem in problems),
            f"expected an error containing {needle!r}, got {problems}",
        )

    def test_the_pristine_document_passes(self):
        """The control. Without it, a checker that rejects everything passes."""
        self.assertEqual(errors_for(PRISTINE), [])

    def test_a_missing_section_is_caught(self):
        self.assert_catches(
            PRISTINE.replace("## 4. Decisions in force — do not re-litigate", "## 4. Decisions"),
            "missing required section",
        )

    def test_a_part_with_no_owner_is_caught(self):
        self.assert_catches(
            replace_cell(PRISTINE, "3. Student experience and AR", 1, ""),
            "has no owner cell",
        )

    def test_an_owned_part_with_no_branch_is_caught(self):
        self.assert_catches(
            replace_cell(PRISTINE, "5. Content, camera, and demo QA", 2, "—"),
            "branch cell says",
        )

    def test_a_vague_branch_cell_on_an_owned_part_is_caught(self):
        """"Jacob / not yet created" is honest; "Jacob / soon" says nothing."""
        self.assert_catches(
            replace_cell(PRISTINE, "2. Instructor capture", 2, "soon"),
            "branch cell says",
        )

    def test_the_not_yet_created_admission_is_accepted(self):
        self.assertEqual(errors_for(PRISTINE), [])
        self.assertTrue(relay_check._is_meaningful_branch("not yet created"))
        self.assertTrue(relay_check._is_meaningful_branch("`workstream/5-content-camera-qa`, PR #4 open"))
        self.assertTrue(relay_check._is_meaningful_branch("merged as `38542ad`"))
        self.assertFalse(relay_check._is_meaningful_branch("soon"))
        self.assertFalse(relay_check._is_meaningful_branch("—"))

    def test_an_invalid_thread_status_is_caught(self):
        self.assert_catches(replace_cell(PRISTINE, "T-05", 4, "probably fine"), "is not one of")

    def test_a_closed_thread_without_evidence_is_caught(self):
        self.assert_catches(replace_cell(PRISTINE, "T-02", 5, "—"), "with no evidence")

    def test_an_owner_named_beside_an_unowned_status_is_caught(self):
        """The real bug the by-hand pass found: the rule was one-directional."""
        self.assert_catches(
            replace_cell(PRISTINE, "T-01", 2, "Part 1"), "must appear in both cells or neither"
        )

    def test_an_unowned_owner_beside_a_real_status_is_caught(self):
        self.assert_catches(
            replace_cell(PRISTINE, "T-01", 4, "IN PROGRESS"), "must appear in both cells or neither"
        )

    def test_a_log_entry_missing_a_required_field_is_caught(self):
        self.assert_catches(
            PRISTINE.replace("**Threads touched:** T-14 opened (`dist/` committed).\n", "", 1),
            "is missing the **Threads touched:** line",
        )

    def test_a_log_entry_citing_an_unknown_thread_is_caught(self):
        self.assert_catches(
            PRISTINE.replace("**Threads touched:** T-14 opened (`dist/` committed).", "**Threads touched:** T-99 opened.", 1),
            "which is not in the section 3 register",
        )

    def test_an_out_of_sequence_log_id_is_caught(self):
        self.assert_catches(PRISTINE.replace("### RL-002 —", "### RL-004 —", 1), "out of sequence")

    def test_a_malformed_log_heading_is_caught(self):
        self.assert_catches(
            PRISTINE.replace("### RL-002 — 2026-09-15 — Part 5 — Kunj Rathod", "### RL-002 Part 5 Kunj Rathod", 1),
            "log heading is not",
        )

    def test_an_unparseable_log_date_is_caught(self):
        self.assert_catches(
            PRISTINE.replace("### RL-002 — 2026-09-15 —", "### RL-002 — 2026-13-45 —", 1),
            "unparseable date",
        )

    def test_a_duplicate_thread_id_is_caught(self):
        self.assert_catches(replace_cell(PRISTINE, "T-16", 0, "T-15"), "duplicate thread id")

    def test_a_malformed_thread_id_is_caught(self):
        self.assert_catches(replace_cell(PRISTINE, "T-16", 0, "T16"), "is not in T-NN form")


class TableParsing(unittest.TestCase):
    """The reviewer's second point: naive `|` splitting desyncs on a literal pipe."""

    def test_an_unescaped_pipe_is_diagnosed_not_just_detected(self):
        mutated = replace_cell(PRISTINE, "T-12", 1, "Run `git log | head` to inspect it")
        problems = errors_for(mutated)
        self.assertTrue(problems, "a pipe inside a cell was silently absorbed")
        self.assertTrue(
            any("unescaped `|`" in problem for problem in problems),
            f"the error should name the real cause, got {problems}",
        )

    def test_an_escaped_pipe_is_accepted_and_preserved(self):
        """The workaround the error message recommends has to actually work."""
        mutated = replace_cell(PRISTINE, "T-12", 1, "Run `git log \\| head` to inspect it")
        self.assertEqual(errors_for(mutated), [])
        rows = relay_check._rows(mutated, relay_check.REQUIRED_SECTIONS[2])
        row = next(r for r in rows if r[0] == "T-12")
        self.assertIn("git log | head", row[1])

    def test_a_missing_cell_is_diagnosed_differently(self):
        row = next(line for line in PRISTINE.splitlines() if line.strip().startswith("| T-12 |"))
        mutated = PRISTINE.replace(row, "| T-12 | short | UNOWNED | Nothing | UNOWNED |", 1)
        problems = errors_for(mutated)
        self.assertTrue(any("a cell is missing" in problem for problem in problems), problems)


class WiredIntoTheBuild(unittest.TestCase):
    """A checker nothing runs is a checker that does not exist.

    This is not hypothetical here. Merging PR #5 resolved a Makefile conflict by
    taking the other side, which silently dropped `relay-check` from `check` and
    removed the `freeze-check` target entirely. Both scripts stayed in the tree,
    so nothing looked wrong. These assertions make that lossy resolution fail
    loudly the next time.
    """

    MAKEFILE = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")

    def test_check_depends_on_relay_check(self):
        target = next(
            (line for line in self.MAKEFILE.splitlines() if line.startswith("check:")), ""
        )
        self.assertIn("relay-check", target, "make check no longer runs the relay checker")

    def test_relay_check_runs_this_suite(self):
        self.assertIn("python3 -m unittest discover -s tests/relay", self.MAKEFILE)

    def test_the_freeze_gate_target_exists(self):
        self.assertIn("freeze-check:", self.MAKEFILE)
        self.assertIn("relay_check.py --freeze", self.MAKEFILE)


class FreezeGate(unittest.TestCase):
    def test_settled_statuses_are_the_ones_that_close_the_gate(self):
        """`freeze-check` must not accept OPEN or UNOWNED as finished."""
        self.assertEqual(relay_check.EVIDENCE_REQUIRED, {"CLOSED", "ACCEPTED"})
        for status in ("OPEN", "BLOCKED", "IN PROGRESS", "UNOWNED"):
            self.assertIn(status, relay_check.THREAD_STATUSES)
            self.assertNotIn(status, relay_check.EVIDENCE_REQUIRED)


if __name__ == "__main__":
    unittest.main()
