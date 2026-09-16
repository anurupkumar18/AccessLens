"""Regression tests for the repository-native AccessLens delivery system."""

from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import agent_context  # noqa: E402
import work_board  # noqa: E402
import work_board_check  # noqa: E402


class WorkBoardValidation(unittest.TestCase):
    def test_checked_in_delivery_board_is_valid(self):
        self.assertEqual(work_board_check.check(), [])

    def test_ticket_ids_and_filenames_are_canonical(self):
        documents = work_board_check.ticket_documents()
        self.assertEqual(len({document.metadata["id"] for document in documents}), len(documents))
        for document in documents:
            metadata = document.metadata
            self.assertEqual(
                document.path.name,
                f"{metadata['id'].lower()}-{work_board_check.slug(metadata['title'])}.md",
            )

    def test_ready_ticket_with_a_dependency_is_rejected_without_waiver(self):
        source = next(
            document
            for document in work_board_check.ticket_documents()
            if document.metadata["id"] == "AL-002"
        )
        metadata = dict(source.metadata)
        metadata["status"] = "READY"
        mutation = work_board_check.Document(source.path, metadata, source.body)
        errors = work_board_check.validate_ticket(
            mutation,
            {document.metadata["id"] for document in work_board_check.ticket_documents()},
            work_board_check.relay_thread_ids(),
        )
        self.assertTrue(any("READY ticket has dependencies" in error for error in errors), errors)

    def test_generated_board_is_derived_from_ticket_files(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(work_board.main(), 0)
        rendered = output.getvalue()
        self.assertIn("# AccessLens delivery board", rendered)
        self.assertIn("AL-001", rendered)
        self.assertIn("AL-090", rendered)

    def test_agent_context_marks_t29_non_blocking(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(agent_context.main(), 0)
        self.assertIn("T-29: OPEN (non-blocking meeting agenda)", output.getvalue())


if __name__ == "__main__":
    unittest.main()
