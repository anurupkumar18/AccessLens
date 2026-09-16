"""Print a compact repository-native briefing for an incoming AccessLens agent."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from work_board_check import CLAIMS, RELAY, ROOT, UPDATES, check, list_value, ticket_documents


def git_output(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=False).stdout.strip() or "unknown"


def t29_status() -> str:
    text = RELAY.read_text(encoding="utf-8")
    match = re.search(r"\| T-29 \|.*?\| (OPEN|BLOCKED|CLOSED|ACCEPTED) \|", text)
    return f"{match.group(1) if match else 'unknown'} (non-blocking meeting agenda)"


def main() -> int:
    errors = check()
    if errors:
        print("Agent context unavailable because the delivery board is invalid:", file=sys.stderr)
        print("\n".join(f"  - {error}" for error in errors), file=sys.stderr)
        return 1
    tickets = ticket_documents()
    ready = [ticket for ticket in tickets if ticket.metadata["status"] == "READY"]
    active = [ticket for ticket in tickets if ticket.metadata["status"] in {"CLAIMED", "IN_PROGRESS", "IN_REVIEW"}]
    updates = sorted(path.name for path in UPDATES.glob("*.md"))
    print("ACCESSLENS AGENT CONTEXT")
    print(f"Release SHA: {git_output('rev-parse', '--short', 'HEAD')}")
    print("Active product decision: docs/product/DEC-001-live-meaning-moment.md")
    print("Current demo contract: docs/product/DEMO_CONTRACT.md")
    print(f"Alignment agenda T-29: {t29_status()}")
    print(f"Verified baseline: {git_output('log', '-1', '--format=%h %s')}")
    print("\nREADY TICKETS")
    for ticket in ready:
        meta = ticket.metadata
        print(f"- {meta['id']} [{meta['priority']}] {meta['title']} — {meta['demo_impact']}")
    print("\nACTIVE TICKETS")
    if active:
        for ticket in active:
            meta = ticket.metadata
            print(f"- {meta['id']} [{meta['status']}] {meta['title']}")
    else:
        print("- none")
    print("\nLATEST UPDATES")
    for update in updates[-5:] or ["none"]:
        print(f"- {update}")
    print("\nHUMAN DECISIONS REQUIRED")
    for ticket in tickets:
        decision = ticket.metadata["human_decision"]
        if decision != "none" and ticket.metadata["status"] not in {"DONE", "DEFERRED"}:
            print(f"- {ticket.metadata['id']}: {decision}")
    print("\nNEXT ACTION")
    print("Claim one READY ticket only after reading its ticket file and linked relay threads.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
