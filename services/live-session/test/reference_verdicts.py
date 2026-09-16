"""Emit Part 5's verdicts for every fixture event, for the parity test.

This imports `reference_event_check.py` rather than reimplementing it. Part 5
owns those rules; Part 4's job is to agree with them, and the only way to prove
agreement is to ask the original.

The tool's own `_main` covers the negative fixtures only, because that is what
its caller needed. The parity test needs the positive scenarios too -- a rule
that fires when it should not is as much a bug as one that fails to fire, and
the happy path is where that would show up.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[3] / "packages/access-packs/bio-cell-demo"
sys.path.insert(0, str(PACK_ROOT / "tools"))

from reference_event_check import check_event  # noqa: E402


def main() -> int:
    pack = json.loads((PACK_ROOT / "pack.json").read_text(encoding="utf-8"))
    verdicts = []

    for path in sorted((PACK_ROOT / "fixtures").glob("*.json")):
        fixture = json.loads(path.read_text(encoding="utf-8"))
        # Scenarios are ordered streams, so the sequence gate needs the running
        # high-water mark rather than a fixed 0 -- exactly as the relay keeps it.
        last = 0
        for index, event in enumerate(fixture["events"]):
            verdicts.append(
                {
                    "source": f"{fixture['scenario']}#{index}",
                    "event": event,
                    "lastSequence": last,
                    "broken": check_event(event, pack, last_sequence=last),
                }
            )
            sequence = event.get("sequence")
            if isinstance(sequence, int) and sequence > last:
                last = sequence

    for path in sorted((PACK_ROOT / "fixtures" / "invalid").glob("*.json")):
        fixture = json.loads(path.read_text(encoding="utf-8"))
        verdicts.append(
            {
                "source": f"invalid/{fixture['fixture']}",
                "event": fixture["event"],
                "lastSequence": fixture["lastDeliveredSequence"],
                "expectedRule": fixture["expectedRule"],
                "broken": check_event(
                    fixture["event"], pack, last_sequence=fixture["lastDeliveredSequence"]
                ),
            }
        )

    json.dump(verdicts, sys.stdout, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
