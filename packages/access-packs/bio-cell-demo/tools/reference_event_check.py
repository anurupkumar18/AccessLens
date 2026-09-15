"""Executable specification for the rules a LiveEvent must satisfy.

This is NOT the canonical contract. Part 1 owns `packages/contracts/` and will
express these rules in Zod and JSON Schema; Part 4 enforces them again at the
relay. Until those exist, the fixtures in `fixtures/invalid/` would be a pile of
JSON nobody checks, so this module states each rule once, in the standard
library, and the pack's guardrail suite asserts that every negative fixture
trips exactly the rule it documents.

When Part 1's contract lands, port these rules and keep the fixtures pointed at
it; the rule names below are meant to survive that move.
"""

from __future__ import annotations

ALLOWED_EVENT_TYPES = (
    "session.started",
    "asset.changed",
    "region.changed",
    "caption.appended",
    "capture.paused",
    "capture.resumed",
    "source.unmatched",
    "session.ended",
)

REQUIRED_FIELDS = ("schemaVersion", "type", "sessionId", "packId", "packVersion", "sequence", "sentAt")

# Fields that describe the instructional moment. Anything else on an event is
# either media or a learner inference, and both are prohibited.
KNOWN_FIELDS = set(REQUIRED_FIELDS) | {
    "assetId",
    "regionId",
    "pointer",
    "arState",
    "caption",
    "reason",
    "nearestDistanceBits",
    "correctionAvailable",
    "redelivery",
}

INSTRUCTOR_ONLY_TYPES = (
    "session.started",
    "asset.changed",
    "region.changed",
    "caption.appended",
    "capture.paused",
    "capture.resumed",
    "source.unmatched",
    "session.ended",
)


def check_event(event: dict, pack: dict, last_sequence: int = 0) -> list[str]:
    """Return the rule names an event breaks. Empty list means acceptable."""
    broken: list[str] = []

    for field in REQUIRED_FIELDS:
        if field not in event:
            broken.append(f"missing-required-field:{field}")

    if event.get("type") not in ALLOWED_EVENT_TYPES:
        broken.append("event-type-not-allowlisted")

    unknown = sorted(set(event) - KNOWN_FIELDS)
    for field in unknown:
        broken.append(f"field-not-on-contract:{field}")

    if event.get("packId") != pack["packId"]:
        broken.append("pack-id-mismatch")
    if event.get("packVersion") != pack["version"]:
        broken.append("pack-version-mismatch")

    sequence = event.get("sequence")
    if not isinstance(sequence, int) or sequence < 1:
        broken.append("sequence-not-a-positive-integer")
    elif sequence <= last_sequence:
        broken.append("sequence-not-monotonic")

    pointer = event.get("pointer")
    if pointer is not None:
        for axis in ("x", "y"):
            value = pointer.get(axis)
            if not isinstance(value, (int, float)) or not 0.0 <= value <= 1.0:
                broken.append(f"pointer-out-of-range:{axis}")

    assets = {asset["assetId"]: asset for asset in pack["assets"]}
    asset_id = event.get("assetId")
    if asset_id is not None and asset_id not in assets:
        broken.append("asset-not-in-pack")

    region_id = event.get("regionId")
    if region_id is not None:
        asset = assets.get(asset_id)
        if asset is None or region_id not in {r["regionId"] for r in asset["regions"]}:
            broken.append("region-not-in-pack")

    ar_state = event.get("arState")
    if isinstance(ar_state, dict) and ar_state.get("hotspotId") is not None:
        asset = assets.get(asset_id)
        hotspot = None
        if asset is not None:
            hotspot = next(
                (h for h in asset["arScene"]["hotspots"] if h["hotspotId"] == ar_state["hotspotId"]),
                None,
            )
        if hotspot is None:
            broken.append("hotspot-not-in-pack")
        elif region_id is not None and hotspot["regionId"] != region_id:
            broken.append("hotspot-region-mismatch")

    if event.get("type") == "source.unmatched":
        for field in ("assetId", "regionId"):
            if event.get(field) is not None:
                broken.append(f"unmatched-event-names-content:{field}")
        if isinstance(ar_state, dict) and ar_state.get("hotspotId") is not None:
            broken.append("unmatched-event-names-content:arState.hotspotId")

    return broken
