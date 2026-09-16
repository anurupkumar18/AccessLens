"""Check the pack and its fixtures against Part 1's checked-in JSON Schemas.

Part 1 landed `packages/contracts/*.schema.json` in df80b5d. Those artifacts are
the language-neutral interchange contract -- what Part 4 would validate against
server-side, where no Zod runtime exists -- so this is the check that decides
whether the reviewed pack and the simulator fixtures are actually shippable
through the shared contract.

They are not, yet. The contract is narrower than the product: `assetId` is
required on every event, which makes the charter-required `source.unmatched`
unrepresentable, and neither schema names `arState`, which the AR renderer
needs. The gaps are enumerated in `EXPECTED_GAPS` below and in
`docs/PART5_CONTRACT_CONFORMANCE.md`, and this tool fails on any gap that is
NOT one of them.

A closed gap prints a notice and passes rather than failing: whoever widens the
contract should not get a red build for doing the right thing. Reconcile the
list when you see the notice.

Usage:  python3 packages/access-packs/bio-cell-demo/tools/check_contract_conformance.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PACK_ROOT.parents[2]
CONTRACTS = REPO_ROOT / "packages" / "contracts"
PACK_FILE = PACK_ROOT / "pack.json"
FIXTURES = PACK_ROOT / "fixtures"

# Every incompatibility known when this check was written, as
# "<schema>:<kind>:<detail>". Anything outside this set is a new break and
# fails. See docs/PART5_CONTRACT_CONFORMANCE.md for why each one is here.
EXPECTED_GAPS = {
    # --- Pack: reviewed content the schema does not model yet ---------------
    # The most serious of these is `arScene`. AR is a required student renderer
    # (charter A10, task A12) and the pack schema currently forbids the pack
    # from carrying the AR scene at all.
    "AccessPack:additional-property:assets[].arScene",
    "AccessPack:additional-property:assets[].mediaUri",
    "AccessPack:additional-property:assets[].subtitle",
    "AccessPack:additional-property:assets[].regions[].label",
    "AccessPack:additional-property:review",
    "AccessPack:additional-property:matching",
    "AccessPack:additional-property:arCameras",
    "AccessPack:additional-property:reservedReadingOrderIds",
    # --- Events: caption.appended cannot carry a caption --------------------
    # The type is base-only in the contract, so neither the caption text nor
    # the asset it belongs to can be sent. Kept in the fixtures rather than
    # worked around, because a caption event with no caption is not a design.
    "LiveEvent:additional-property:caption",
    "LiveEvent:forbidden-property:assetId",
}



def load_schema(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


# Keywords the contracts actually use. Anything outside this set raises rather
# than passing quietly -- the guard already earned its keep once, when Part 1
# rewrote the event schema as an if/then matrix and this check stopped instead
# of silently reporting that everything was fine.
SUPPORTED_KEYWORDS = {
    "$schema", "title", "description",
    "type", "const", "enum", "format",
    "required", "properties", "additionalProperties",
    "items", "minItems", "minLength", "maxLength", "minimum", "maximum",
    "allOf", "if", "then",
}

_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
}


def _assert_supported(node: object, label: str) -> None:
    if isinstance(node, dict):
        unhandled = set(node) - SUPPORTED_KEYWORDS
        # Inside a `properties` map the keys are field names, not keywords.
        if unhandled and not _looks_like_property_map(node):
            raise NotImplementedError(
                f"{label} schema uses unsupported keywords: {sorted(unhandled)}"
            )
        for key, value in node.items():
            _assert_supported(value, label) if key != "properties" else [
                _assert_supported(sub, label) for sub in value.values()
            ]
    elif isinstance(node, list):
        for value in node:
            _assert_supported(value, label)


def _looks_like_property_map(node: dict) -> bool:
    """A dict of field name -> subschema, rather than a schema itself."""
    return bool(node) and all(isinstance(v, (dict, bool)) for v in node.values()) and not (
        set(node) & SUPPORTED_KEYWORDS
    )


def _join(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key


def _check(instance: object, schema: object, path: str) -> list[tuple[str, str]]:
    """Evaluate one instance against one (sub)schema. Returns (kind, path) pairs."""
    if schema is False:
        return [("forbidden-property", path or "<root>")]
    if schema is True or schema == {}:
        return []
    assert isinstance(schema, dict)

    gaps: list[tuple[str, str]] = []
    where = path or "<root>"

    expected = schema.get("type")
    if expected is not None:
        python_type = _TYPES.get(expected)
        # bool is a subclass of int in Python; JSON Schema does not agree.
        wrong = python_type is not None and (
            not isinstance(instance, python_type)
            or (expected in ("integer", "number") and isinstance(instance, bool))
        )
        if wrong:
            return [("wrong-type", where)]

    if "const" in schema and instance != schema["const"]:
        gaps.append(("const-mismatch", where))
    if "enum" in schema and instance not in schema["enum"]:
        gaps.append(("not-in-enum", where))
    if isinstance(instance, str) and len(instance) < schema.get("minLength", 0):
        gaps.append(("too-short", where))
    # Part 6 caps a course-library quote at 300 characters so a student is never
    # shown more of a professor's textbook than a citation needs (T-31, T-36).
    if isinstance(instance, str) and "maxLength" in schema and len(instance) > schema["maxLength"]:
        gaps.append(("too-long", where))
    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            gaps.append(("below-minimum", where))
        if "maximum" in schema and instance > schema["maximum"]:
            gaps.append(("above-maximum", where))

    if isinstance(instance, list):
        if len(instance) < schema.get("minItems", 0):
            gaps.append(("too-few-items", where))
        item_schema = schema.get("items")
        if item_schema is not None:
            for element in instance:
                gaps.extend(_check(element, item_schema, f"{path}[]"))

    if isinstance(instance, dict):
        properties = schema.get("properties", {})
        for field in schema.get("required", []):
            if field not in instance:
                gaps.append(("missing-required", _join(path, field)))
        if schema.get("additionalProperties") is False:
            for field in sorted(set(instance) - set(properties)):
                gaps.append(("additional-property", _join(path, field)))
        for field, subschema in properties.items():
            if field in instance:
                gaps.extend(_check(instance[field], subschema, _join(path, field)))

    for entry in schema.get("allOf", []):
        condition = entry.get("if")
        if condition is not None and _check(instance, condition, path):
            continue  # The `if` did not match, so `then` does not apply.
        gaps.extend(_check(instance, entry.get("then", {}), path))

    return gaps


def validate(instance: object, schema: dict, label: str) -> list[str]:
    """Check one instance against the JSON Schema subset these contracts use.

    Array positions collapse to `[]` so a gap id stays stable no matter which
    asset or region carries the problem.
    """
    _assert_supported(schema, label)
    return [f"{label}:{kind}:{where}" for kind, where in _check(instance, schema, "")]


def collect_gaps() -> tuple[set[str], dict[str, int]]:
    pack_schema = load_schema("access-pack.schema.json")
    event_schema = load_schema("live-event.schema.json")

    gaps: set[str] = set()
    counts: dict[str, int] = {}

    pack = json.loads(PACK_FILE.read_text(encoding="utf-8"))
    for gap in validate(pack, pack_schema, "AccessPack"):
        gaps.add(gap)
        counts[gap] = counts.get(gap, 0) + 1

    for path in sorted(FIXTURES.glob("*.json")):
        fixture = json.loads(path.read_text(encoding="utf-8"))
        for event in fixture["events"]:
            for gap in validate(event, event_schema, "LiveEvent"):
                gaps.add(gap)
                counts[gap] = counts.get(gap, 0) + 1
    return gaps, counts


def per_event_verdicts() -> list[dict]:
    """One verdict per fixture event, for cross-checking against Zod.

    This module reimplements a subset of JSON Schema, and a reimplementation
    drifts from the thing it imitates. `tests/e2e/fixture-replay.test.ts` runs
    the same events through Part 1's Zod schema -- the actual runtime authority
    -- and fails if the two ever disagree about a single event.
    """
    event_schema = load_schema("live-event.schema.json")
    verdicts = []
    for path in sorted(FIXTURES.glob("*.json")):
        fixture = json.loads(path.read_text(encoding="utf-8"))
        for index, event in enumerate(fixture["events"]):
            verdicts.append(
                {
                    "fixture": path.stem,
                    "index": index,
                    "sequence": event.get("sequence"),
                    "type": event.get("type"),
                    "gaps": validate(event, event_schema, "LiveEvent"),
                }
            )
    return verdicts


def main() -> int:
    if "--json" in sys.argv[1:]:
        print(json.dumps(per_event_verdicts(), indent=2))
        return 0

    if not CONTRACTS.exists():
        print("packages/contracts/ does not exist yet; nothing to check against.")
        return 0

    gaps, counts = collect_gaps()
    unexpected = sorted(gaps - EXPECTED_GAPS)
    closed = sorted(EXPECTED_GAPS - gaps)

    if unexpected:
        print("New incompatibility with packages/contracts/ that is not documented:")
        for gap in unexpected:
            print(f"  - {gap} ({counts[gap]} occurrence(s))")
        print(
            "\nEither the pack changed and must be brought back in line, or the shared "
            "contract narrowed. Resolve it and update EXPECTED_GAPS and "
            "docs/PART5_CONTRACT_CONFORMANCE.md."
        )
        return 1

    print(f"Checked pack.json and every fixture event against {CONTRACTS.relative_to(REPO_ROOT)}.")
    print(f"{len(gaps)} known gap(s), all documented:")
    for gap in sorted(gaps):
        print(f"  - {gap} ({counts[gap]} occurrence(s))")
    if closed:
        print("\nNotice: these documented gaps have CLOSED. The contract now accepts them.")
        for gap in closed:
            print(f"  - {gap}")
        print("Remove them from EXPECTED_GAPS and docs/PART5_CONTRACT_CONFORMANCE.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
