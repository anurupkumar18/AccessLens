"""Validate AccessLens agent-delivery tickets, claims, and immutable updates."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "docs" / "work"
TICKETS = WORK / "tickets"
CLAIMS = WORK / "claims"
UPDATES = WORK / "updates"
RELAY = ROOT / "docs" / "CONTEXT_RELAY.md"

STATUSES = {"BLOCKED", "READY", "CLAIMED", "IN_PROGRESS", "IN_REVIEW", "DONE", "DEFERRED"}
PRIORITIES = {"P0", "P1", "P2", "P3"}
DATA_IMPACTS = {"none", "local-only", "temporary-service", "persistent-instructor-content"}
UPDATE_TYPES = {"CLAIM", "CHECKPOINT", "BLOCKER", "CONTRACT_DELTA", "PRODUCT_DELTA", "DEMO_DELTA", "MERGED", "HANDOFF"}
REQUIRED_TICKET_FIELDS = {
    "id", "title", "status", "priority", "depends_on", "task_ids", "threads",
    "affected_paths", "contract_impact", "data_impact", "demo_impact", "human_decision",
}
REQUIRED_UPDATE_FIELDS = {
    "ticket", "type", "status", "branch", "commit", "product_impact", "demo_impact",
    "data_impact", "checks", "remaining_risk",
}
REQUIRED_TICKET_HEADINGS = (
    "## Outcome", "## Scope", "## Non-goals", "## Acceptance criteria", "## Test plan",
    "## Failure behavior", "## Handoff requirements",
)
TICKET_ID = re.compile(r"AL-(?:D)?\d{3}")
UPDATE_NAME = re.compile(r"^(AL-(?:D)?\d{3})-([A-Z_]+)-\d{8}-\d{4}\.md$")


@dataclass(frozen=True)
class Document:
    path: Path
    metadata: dict[str, str]
    body: str


def parse_front_matter(path: Path) -> Document:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError("missing opening front matter delimiter")
    try:
        _, front, body = text.split("---\n", 2)
    except ValueError as error:
        raise ValueError("missing closing front matter delimiter") from error
    metadata: dict[str, str] = {}
    for line in front.splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError(f"front matter line has no colon: {line!r}")
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if not key or key in metadata:
            raise ValueError(f"invalid or duplicate front matter key: {key!r}")
        metadata[key] = value
    return Document(path=path, metadata=metadata, body=body)


def list_value(value: str) -> list[str]:
    if not (value.startswith("[") and value.endswith("]")):
        raise ValueError("expected a bracketed list")
    payload = value[1:-1].strip()
    return [] if not payload else [item.strip() for item in payload.split(",") if item.strip()]


def ticket_documents() -> list[Document]:
    documents = []
    for path in sorted(TICKETS.glob("*.md")):
        try:
            documents.append(parse_front_matter(path))
        except ValueError as error:
            raise ValueError(f"{path.relative_to(ROOT)}: {error}") from error
    return documents


def relay_thread_ids() -> set[str]:
    if not RELAY.exists():
        return set()
    return set(re.findall(r"\| (T-\d{2}) \|", RELAY.read_text(encoding="utf-8")))


def validate_ticket(document: Document, ids: set[str], threads: set[str]) -> list[str]:
    errors: list[str] = []
    meta = document.metadata
    label = str(document.path.relative_to(ROOT))
    missing = REQUIRED_TICKET_FIELDS - meta.keys()
    if missing:
        errors.append(f"{label}: missing ticket fields {', '.join(sorted(missing))}")
        return errors
    ticket_id = meta["id"]
    if not TICKET_ID.fullmatch(ticket_id):
        errors.append(f"{label}: invalid id {ticket_id!r}")
    if document.path.name != f"{ticket_id.lower()}-{slug(meta['title'])}.md":
        errors.append(f"{label}: filename must be {ticket_id.lower()}-{slug(meta['title'])}.md")
    if meta["status"] not in STATUSES:
        errors.append(f"{label}: invalid status {meta['status']!r}")
    if meta["priority"] not in PRIORITIES:
        errors.append(f"{label}: invalid priority {meta['priority']!r}")
    if meta["data_impact"] not in DATA_IMPACTS:
        errors.append(f"{label}: invalid data_impact {meta['data_impact']!r}")
    if not meta["title"] or not meta["demo_impact"] or not meta["human_decision"]:
        errors.append(f"{label}: title, demo_impact, and human_decision must be non-empty")
    try:
        dependencies = list_value(meta["depends_on"])
        ticket_threads = list_value(meta["threads"])
        list_value(meta["task_ids"])
        list_value(meta["affected_paths"])
    except ValueError as error:
        errors.append(f"{label}: {error}")
        return errors
    for dependency in dependencies:
        if dependency not in ids:
            errors.append(f"{label}: unknown dependency {dependency}")
    for thread in ticket_threads:
        if thread not in threads:
            errors.append(f"{label}: unknown relay thread {thread}")
    if meta["status"] == "READY":
        unfinished = [dependency for dependency in dependencies if dependency in ids]
        if unfinished and meta.get("dependency_waiver") != "recorded":
            errors.append(f"{label}: READY ticket has dependencies; mark it BLOCKED or record a dependency_waiver")
    for heading in REQUIRED_TICKET_HEADINGS:
        if heading not in document.body:
            errors.append(f"{label}: missing {heading}")
    return errors


def slug(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.lower())).strip("-")


def validate_claims(tickets: dict[str, Document]) -> list[str]:
    errors: list[str] = []
    for path in sorted(CLAIMS.glob("*.md")):
        try:
            document = parse_front_matter(path)
        except ValueError as error:
            errors.append(f"{path.relative_to(ROOT)}: {error}")
            continue
        ticket = document.metadata.get("ticket")
        if not ticket or ticket not in tickets:
            errors.append(f"{path.relative_to(ROOT)}: claim names unknown ticket {ticket!r}")
            continue
        if path.name != f"{ticket}.md":
            errors.append(f"{path.relative_to(ROOT)}: claim filename must be {ticket}.md")
        for field in ("agent", "branch", "base_commit", "first_checkpoint"):
            if not document.metadata.get(field):
                errors.append(f"{path.relative_to(ROOT)}: missing {field}")
        if tickets[ticket].metadata["status"] not in {"CLAIMED", "IN_PROGRESS", "IN_REVIEW"}:
            errors.append(f"{path.relative_to(ROOT)}: claimed ticket {ticket} is not active")
    return errors


def validate_updates(tickets: dict[str, Document]) -> list[str]:
    errors: list[str] = []
    for path in sorted(UPDATES.glob("*.md")):
        match = UPDATE_NAME.fullmatch(path.name)
        if not match:
            errors.append(f"{path.relative_to(ROOT)}: update filename must be AL-###-TYPE-YYYYMMDD-HHMM.md")
            continue
        try:
            document = parse_front_matter(path)
        except ValueError as error:
            errors.append(f"{path.relative_to(ROOT)}: {error}")
            continue
        meta = document.metadata
        missing = REQUIRED_UPDATE_FIELDS - meta.keys()
        if missing:
            errors.append(f"{path.relative_to(ROOT)}: missing update fields {', '.join(sorted(missing))}")
            continue
        if meta["ticket"] != match.group(1) or meta["ticket"] not in tickets:
            errors.append(f"{path.relative_to(ROOT)}: filename and ticket field disagree or ticket is unknown")
        if meta["type"] != match.group(2) or meta["type"] not in UPDATE_TYPES:
            errors.append(f"{path.relative_to(ROOT)}: filename and type field disagree or type is invalid")
        if meta["status"] not in STATUSES:
            errors.append(f"{path.relative_to(ROOT)}: invalid status {meta['status']!r}")
        if meta["data_impact"] not in DATA_IMPACTS:
            errors.append(f"{path.relative_to(ROOT)}: invalid data_impact {meta['data_impact']!r}")
        if not document.body.strip():
            errors.append(f"{path.relative_to(ROOT)}: update body is required")
    return errors


def check() -> list[str]:
    errors: list[str] = []
    for directory in (TICKETS, CLAIMS, UPDATES):
        if not directory.exists():
            errors.append(f"missing required delivery directory {directory.relative_to(ROOT)}")
    if errors:
        return errors
    try:
        documents = ticket_documents()
    except ValueError as error:
        return [str(error)]
    if not documents:
        return ["docs/work/tickets has no tickets"]
    ids = [document.metadata.get("id", "") for document in documents]
    duplicates = sorted({ticket for ticket in ids if ids.count(ticket) > 1})
    if duplicates:
        errors.append(f"duplicate ticket ids: {', '.join(duplicates)}")
    ticket_ids = set(ids)
    threads = relay_thread_ids()
    for document in documents:
        errors.extend(validate_ticket(document, ticket_ids, threads))
    tickets = {document.metadata.get("id", ""): document for document in documents}
    errors.extend(validate_claims(tickets))
    errors.extend(validate_updates(tickets))
    return errors


def main() -> int:
    errors = check()
    if errors:
        print("AccessLens delivery board failed validation:")
        print("\n".join(f"  - {error}" for error in errors))
        return 1
    count = len(ticket_documents())
    print(f"Validated AccessLens delivery board: {count} tickets, {len(list(CLAIMS.glob('*.md')))} claims, {len(list(UPDATES.glob('*.md')))} updates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
