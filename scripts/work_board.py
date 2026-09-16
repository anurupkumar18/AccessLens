"""Render compact derived views of the AccessLens delivery board."""

from __future__ import annotations

import subprocess
import sys
from collections import defaultdict

from work_board_check import ROOT, TICKETS, check, list_value, ticket_documents


def release_sha() -> str:
    return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=False).stdout.strip() or "unknown"


def main() -> int:
    errors = check()
    if errors:
        print("Cannot render an invalid delivery board:", file=sys.stderr)
        print("\n".join(f"  - {error}" for error in errors), file=sys.stderr)
        return 1
    groups: dict[str, list] = defaultdict(list)
    for ticket in ticket_documents():
        groups[ticket.metadata["status"]].append(ticket)
    print("# AccessLens delivery board\n")
    print("Generated from `docs/work/tickets/`; do not edit this output.\n")
    for status in ("IN_PROGRESS", "IN_REVIEW", "READY", "BLOCKED", "DEFERRED", "DONE"):
        tickets = groups.get(status, [])
        if not tickets:
            continue
        print(f"## {status.replace('_', ' ').title()}\n")
        print("| ID | Priority | Ticket | Dependencies | Demo impact |")
        print("| --- | --- | --- | --- | --- |")
        for ticket in tickets:
            meta = ticket.metadata
            dependencies = ", ".join(list_value(meta["depends_on"])) or "—"
            print(f"| {meta['id']} | {meta['priority']} | {meta['title']} | {dependencies} | {meta['demo_impact']} |")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
