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
    # The pack carries reviewed policy the contract does not model yet.
    "AccessPack:additional-property:review",
    "AccessPack:additional-property:matching",
    "AccessPack:additional-property:arCameras",
    "AccessPack:additional-property:reservedReadingOrderIds",
    # AR is a required renderer, but no event schema names its state.
    "LiveEvent:additional-property:arState",
    "LiveEvent:additional-property:caption",
    # `source.unmatched` metadata: why it failed and whether correction is
    # offered. None of it names content.
    "LiveEvent:additional-property:reason",
    "LiveEvent:additional-property:nearestDistanceBits",
    "LiveEvent:additional-property:correctionAvailable",
    # Reconnect redelivery marker.
    "LiveEvent:additional-property:redelivery",
    # The contract requires assetId on every event. Session lifecycle, capture
    # pause/resume, and above all source.unmatched have no asset to name.
    "LiveEvent:missing-required:assetId",
    # Present in the Zod authority but absent from the JSON Schema artifact,
    # which has additionalProperties:false. Part 1's own validEvent fixture
    # fails its own JSON Schema for exactly this reason.
    "LiveEvent:additional-property:regionId",
    "LiveEvent:additional-property:pointer",
}


def load_schema(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def validate(instance: object, schema: dict, label: str) -> list[str]:
    """Check one instance against the JSON Schema subset these contracts use.

    Only the keywords Part 1's artifacts actually contain are implemented:
    type, const, required, additionalProperties, properties, minimum, minItems.
    A keyword appearing that is not handled raises, rather than passing quietly.
    """
    supported = {
        "$schema", "title", "type", "const", "required", "additionalProperties",
        "properties", "minimum", "minItems", "format",
    }
    unhandled = set(schema) - supported
    if unhandled:
        raise NotImplementedError(f"{label} schema uses unsupported keywords: {sorted(unhandled)}")

    gaps: list[str] = []
    expected_type = schema.get("type")
    if expected_type == "object" and not isinstance(instance, dict):
        return [f"{label}:wrong-type:expected-object"]
    if expected_type == "array" and not isinstance(instance, list):
        return [f"{label}:wrong-type:expected-array"]

    if expected_type == "array":
        minimum_items = schema.get("minItems")
        if minimum_items is not None and len(instance) < minimum_items:
            gaps.append(f"{label}:too-few-items")
        return gaps

    assert isinstance(instance, dict)
    properties = schema.get("properties", {})

    for field in schema.get("required", []):
        if field not in instance:
            gaps.append(f"{label}:missing-required:{field}")

    if schema.get("additionalProperties") is False:
        for field in sorted(set(instance) - set(properties)):
            gaps.append(f"{label}:additional-property:{field}")

    for field, subschema in properties.items():
        if field not in instance:
            continue
        value = instance[field]
        if "const" in subschema and value != subschema["const"]:
            gaps.append(f"{label}:const-mismatch:{field}")
        kind = subschema.get("type")
        if kind == "string" and not isinstance(value, str):
            gaps.append(f"{label}:wrong-type:{field}")
        elif kind == "integer" and not isinstance(value, int):
            gaps.append(f"{label}:wrong-type:{field}")
        elif kind == "array" and not isinstance(value, list):
            gaps.append(f"{label}:wrong-type:{field}")
        if kind == "integer" and isinstance(value, int):
            minimum = subschema.get("minimum")
            if minimum is not None and value < minimum:
                gaps.append(f"{label}:below-minimum:{field}")
        if subschema.get("type") == "array" and isinstance(value, list):
            minimum_items = subschema.get("minItems")
            if minimum_items is not None and len(value) < minimum_items:
                gaps.append(f"{label}:too-few-items:{field}")
    return gaps


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


def main() -> int:
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
