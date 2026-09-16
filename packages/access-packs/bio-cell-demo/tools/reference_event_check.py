"""Pack-aware and stream-aware rules a LiveEvent must satisfy.

Part 1's contracts now cover event *shape* properly -- `c3ddc27` made
`LiveEventSchema` a discriminated union per type and mirrored it in
`live-event.schema.json`. Shape is checked there, and
`check_contract_conformance.py` runs the pack and every fixture against it.

What a JSON Schema cannot check is whether an event is consistent with *this*
pack and *this* stream: whether the asset exists, whether the region belongs to
the asset, whether the hotspot matches the region, and whether the sequence
number moved forward. Those rules live here, and the pack's guardrail suite
asserts each negative fixture trips the one it documents.

Keep the rule names stable: Part 4 has to enforce the same rules server-side.
"""

from __future__ import annotations

ALLOWED_EVENT_TYPES = (
    "session.started",
    "asset.changed",
    "region.changed",
    "caption.appended",
    "capture.paused",
    "capture.resumed",
    "capture.stopped",
    "stream.started",
    "stream.stopped",
    "source.unmatched",
    "session.ended",
)

REQUIRED_FIELDS = ("schemaVersion", "type", "sessionId", "packId", "packVersion", "sequence", "sentAt")

# Mirrors the field matrix in packages/contracts/live-event.schema.json.
# `caption` carries a live caption of the instructor's speech on
# caption.appended only: `{text, isFinal}`, text at most CAPTION_MAX_LENGTH
# characters, nothing else. The shape is checked here too because a caption is
# the one free-text field on the contract, so it is where audio or a student's
# words would try to ride along (charter A2, A4).
KNOWN_FIELDS = set(REQUIRED_FIELDS) | {
    "assetId",
    "regionId",
    "pointer",
    "arState",
    "caption",
    "surface",
}

CAPTION_MAX_LENGTH = 500

# `surface` names what the instructor is streaming on stream.started: a tab or a
# window. A whole monitor is never streamed, so it is not a valid value.
STREAM_SURFACES = ("browser", "window")

INSTRUCTOR_ONLY_TYPES = (
    "session.started",
    "asset.changed",
    "region.changed",
    "caption.appended",
    "capture.paused",
    "capture.resumed",
    "capture.stopped",
    "stream.started",
    "stream.stopped",
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

    caption = event.get("caption")
    if event.get("type") == "caption.appended":
        text = caption.get("text") if isinstance(caption, dict) else None
        if (
            not isinstance(caption, dict)
            or set(caption) != {"text", "isFinal"}
            or not isinstance(text, str)
            or not 1 <= len(text) <= CAPTION_MAX_LENGTH
            or not isinstance(caption.get("isFinal"), bool)
        ):
            broken.append("caption-invalid")
    elif caption is not None:
        broken.append("caption-on-wrong-event-type")

    surface = event.get("surface")
    if event.get("type") == "stream.started":
        if not isinstance(surface, str) or surface not in STREAM_SURFACES:
            broken.append("stream-surface-invalid")
    elif surface is not None:
        broken.append("surface-on-wrong-event-type")

    if event.get("type") == "source.unmatched":
        for field in ("assetId", "regionId"):
            if event.get(field) is not None:
                broken.append(f"unmatched-event-names-content:{field}")
        if isinstance(ar_state, dict) and ar_state.get("hotspotId") is not None:
            broken.append("unmatched-event-names-content:arState.hotspotId")

    return broken


def _main() -> int:
    """Emit one verdict per negative fixture, for the TypeScript e2e suite.

    The e2e test needs to know which invalid fixtures this pack-aware layer
    catches, so it can assert that every one of them is rejected by *something*
    -- either Zod on shape, or these rules on pack and stream consistency. A
    negative fixture that nothing rejects is a test asserting nothing.
    """
    import json
    import sys
    from pathlib import Path as _Path

    pack_root = _Path(__file__).resolve().parents[1]
    pack = json.loads((pack_root / "pack.json").read_text(encoding="utf-8"))
    verdicts = []
    for path in sorted((pack_root / "fixtures" / "invalid").glob("*.json")):
        fixture = json.loads(path.read_text(encoding="utf-8"))
        verdicts.append(
            {
                "fixture": fixture["fixture"],
                "expectedRule": fixture["expectedRule"],
                "broken": check_event(
                    fixture["event"], pack, last_sequence=fixture["lastDeliveredSequence"]
                ),
                "event": fixture["event"],
            }
        )
    json.dump(verdicts, sys.stdout, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
