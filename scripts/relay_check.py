"""Validate the structure of docs/CONTEXT_RELAY.md.

A handoff document nobody checks goes stale, and this repository has already
been bitten once: `memory_check.py` carries a guard added after the INDEX's
"current handoff" pointer drifted by eleven records with nothing catching it.

This applies the same idea to the relay. It does not judge whether the prose is
true -- no checker can -- but it does enforce the structure that makes the file
usable to whoever picks it up next:

- every required section is present, so an agent's read order does not break;
- every part has an owner, a state, and a branch (or an explicit em dash);
- every open thread carries a status from a fixed vocabulary, and nothing is
  marked CLOSED or ACCEPTED without evidence in the row;
- every relay log entry has the three fields the template promises;
- log ids are sequential, so an entry cannot be quietly dropped;
- every thread id cited in the log exists in the register.
"""

from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELAY = ROOT / "docs" / "CONTEXT_RELAY.md"

REQUIRED_SECTIONS = (
    "## 1. If you are an agent starting a session, read this first",
    "## 2. Where each part stands",
    "## 3. Open threads",
    "## 4. Decisions in force — do not re-litigate",
    "## 5. Superseded context — present in the repo, not a requirement",
    "## 6. Starting your part today, with what exists",
    "## 7. How to append to this file",
    "## 8. Relay log",
)

THREAD_STATUSES = {"UNOWNED", "OPEN", "IN PROGRESS", "BLOCKED", "CLOSED", "ACCEPTED"}
EVIDENCE_REQUIRED = {"CLOSED", "ACCEPTED"}
EMPTY = {"", "—", "-", "n/a", "N/A", "TBD"}

LOG_FIELDS = ("**Landed:**", "**Threads touched:**", "**Next agent needs to know:**")
LOG_HEADING = re.compile(r"^### (RL-\d{3}) — (\d{4}-\d{2}-\d{2}) — (.+?) — (.+)$")


def _rows(text: str, heading: str) -> list[list[str]]:
    """Return the data rows of the first markdown table under a heading."""
    section = text.split(heading, 1)[1]
    rows = []
    for line in section.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            if rows:
                break
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if all(set(cell) <= {"-", ":"} and cell for cell in cells):
            continue
        rows.append(cells)
    return rows[1:] if rows else []


def check_sections(text: str) -> list[str]:
    return [f"missing required section: {heading}" for heading in REQUIRED_SECTIONS if heading not in text]


def check_parts(text: str) -> list[str]:
    errors = []
    rows = _rows(text, REQUIRED_SECTIONS[1])
    if len(rows) != 5:
        errors.append(f"section 2 lists {len(rows)} parts; the plan defines 5")
    for row in rows:
        if len(row) != 5:
            errors.append(f"section 2 row has {len(row)} columns, expected 5: {row}")
            continue
        part, owner, branch, state, _proof = row
        if owner in EMPTY:
            errors.append(f"part '{part}' has no owner cell; write UNOWNED if that is the truth")
        if branch in EMPTY and owner != "UNOWNED":
            errors.append(f"part '{part}' has an owner but no branch")
        if state in EMPTY:
            errors.append(f"part '{part}' has no state")
    return errors


def check_threads(text: str) -> tuple[list[str], set[str]]:
    errors = []
    ids: set[str] = set()
    rows = _rows(text, REQUIRED_SECTIONS[2])
    if not rows:
        errors.append("section 3 has no threads; an empty register is almost certainly wrong")
    for row in rows:
        if len(row) != 6:
            errors.append(f"section 3 row has {len(row)} columns, expected 6: {row[:2]}")
            continue
        thread_id, summary, owner, _blocks, status, evidence = row
        if not re.fullmatch(r"T-\d{2}", thread_id):
            errors.append(f"thread id '{thread_id}' is not in T-NN form")
        elif thread_id in ids:
            errors.append(f"duplicate thread id {thread_id}")
        ids.add(thread_id)
        if summary in EMPTY:
            errors.append(f"{thread_id} has no description")
        if status not in THREAD_STATUSES:
            errors.append(
                f"{thread_id} status '{status}' is not one of {sorted(THREAD_STATUSES)}"
            )
        if owner in EMPTY and status != "UNOWNED":
            errors.append(f"{thread_id} has status {status} but no owner; use UNOWNED or name someone")
        # Owner and status must agree in both directions. A thread with a name
        # against it is not unowned, and an unowned thread has no name.
        if (owner == "UNOWNED") != (status == "UNOWNED"):
            errors.append(
                f"{thread_id} has owner '{owner}' and status '{status}'; "
                "UNOWNED must appear in both cells or neither"
            )
        if status in EVIDENCE_REQUIRED and evidence in EMPTY:
            errors.append(f"{thread_id} is {status} with no evidence; say what proves it")
    return errors, ids


def check_log(text: str, thread_ids: set[str]) -> list[str]:
    errors = []
    section = text.split(REQUIRED_SECTIONS[7], 1)[1]
    entries = re.split(r"^(?=### RL-)", section, flags=re.MULTILINE)[1:]
    if not entries:
        return ["section 8 has no relay log entries"]

    for index, entry in enumerate(entries, start=1):
        heading = entry.splitlines()[0].strip()
        match = LOG_HEADING.match(heading)
        if not match:
            errors.append(
                f"log heading is not '### RL-00N — YYYY-MM-DD — Part N — Name': {heading}"
            )
            continue
        entry_id, stamp, _scope, author = match.groups()
        if int(entry_id.removeprefix("RL-")) != index:
            errors.append(f"{entry_id} is out of sequence; expected RL-{index:03d}")
        try:
            date.fromisoformat(stamp)
        except ValueError:
            errors.append(f"{entry_id} has an unparseable date: {stamp}")
        if author.strip() in EMPTY:
            errors.append(f"{entry_id} has no author")
        for field in LOG_FIELDS:
            if field not in entry:
                errors.append(f"{entry_id} is missing the {field} line")
        for cited in set(re.findall(r"\bT-\d{2}\b", entry)):
            if cited not in thread_ids:
                errors.append(f"{entry_id} cites {cited}, which is not in the section 3 register")
    return errors


def _log_entries(text: str) -> list[str]:
    """Relay log entries, taken from section 8 only.

    Scanning the whole file would also match the blank template inside the
    fenced example in section 7, which is how the first version of this
    function reported one entry more than the log contains.
    """
    section = text.split(REQUIRED_SECTIONS[7], 1)[1]
    return re.split(r"^(?=### RL-)", section, flags=re.MULTILINE)[1:]


def main() -> int:
    freeze = "--freeze" in sys.argv[1:]

    if not RELAY.exists():
        print(f"{RELAY.relative_to(ROOT)} does not exist")
        return 1
    text = RELAY.read_text(encoding="utf-8")

    errors = check_sections(text)
    if errors:
        print("\n".join(f"  - {error}" for error in errors))
        print("\nFix the section headings before the rest can be checked.")
        return 1

    errors += check_parts(text)
    thread_errors, thread_ids = check_threads(text)
    errors += thread_errors
    errors += check_log(text, thread_ids)

    if errors:
        print(f"{RELAY.relative_to(ROOT)} failed {len(errors)} check(s):")
        for error in errors:
            print(f"  - {error}")
        return 1

    parts = _rows(text, REQUIRED_SECTIONS[1])
    threads = _rows(text, REQUIRED_SECTIONS[2])
    settled = {"CLOSED", "ACCEPTED"}
    unsettled = [row for row in threads if row[4] not in settled]
    unowned_parts = [row[0] for row in parts if row[1] == "UNOWNED"]
    unowned_threads = [row[0] for row in threads if row[4] == "UNOWNED"]

    print(
        f"Validated docs/CONTEXT_RELAY.md: {len(parts)} parts, {len(threads)} threads "
        f"({len(unsettled)} unsettled), {len(_log_entries(text))} relay log entries."
    )
    if unowned_parts:
        print(f"  Parts with no owner: {', '.join(unowned_parts)}")
    if unowned_threads:
        print(f"  Threads with no owner: {', '.join(unowned_threads)}")

    if not freeze:
        return 0

    # Handover gate. Run `python3 scripts/relay_check.py --freeze` at feature
    # freeze: every part owned, every thread either closed or consciously
    # accepted. This is the check that turns "no loose ends" into something
    # other than an intention.
    blocking = []
    if unowned_parts:
        blocking.append(f"{len(unowned_parts)} part(s) still unowned: {', '.join(unowned_parts)}")
    if unsettled:
        blocking.append(
            f"{len(unsettled)} thread(s) neither CLOSED nor ACCEPTED: "
            + ", ".join(row[0] for row in unsettled)
        )
    if blocking:
        print("\nNot ready for handover:")
        for line in blocking:
            print(f"  - {line}")
        print(
            "\nEvery remaining thread needs to be closed with evidence, or explicitly "
            "ACCEPTED as something this team decided not to do."
        )
        return 1
    print("\nHandover gate passed: every part owned, every thread settled.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
