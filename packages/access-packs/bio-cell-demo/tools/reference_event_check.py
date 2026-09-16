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
    "source.unmatched",
    "session.ended",
)

REQUIRED_FIELDS = ("schemaVersion", "type", "sessionId", "packId", "packVersion", "sequence", "sentAt")

# Mirrors the field matrix in packages/contracts/live-event.schema.json. This
# flat allowlist does not enforce which type may carry which field -- that
# per-type matrix lives in the JSON Schema/Zod contract and is checked there;
# this list only decides whether a field name is known at all (T-16, closed:
# `caption.appended` carries `caption: {text, isFinal}`, `assetId` when there
# is a current match, text at most CAPTION_MAX_LENGTH characters, nothing
# else -- checked below because a caption is the one free-text field on the
# contract, so it is where audio or a student's words would try to ride along
# (charter A2, A4)).
KNOWN_FIELDS = set(REQUIRED_FIELDS) | {
    "assetId",
    "regionId",
    "pointer",
    "arState",
    "caption",
}

CAPTION_MAX_LENGTH = 500

INSTRUCTOR_ONLY_TYPES = (
    "session.started",
    "asset.changed",
    "region.changed",
    "caption.appended",
    "capture.paused",
    "capture.resumed",
    "capture.stopped",
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

    # T-16's caption payload has no pack-membership fact to check against, but
    # its shape is not covered by the generic REQUIRED_FIELDS/KNOWN_FIELDS
    # checks above (those only ask whether the field name is known, not what
    # it contains) -- and this relay-side layer is the only one a hostile or
    # non-conforming client cannot bypass. Charter A2/A9: never forward an
    # unbounded or malformed value to every student in the session.
    caption = event.get("caption")
    if event.get("type") != "caption.appended":
        if caption is not None:
            broken.append("caption-on-wrong-event-type")
    elif caption is not None:
        if not isinstance(caption, dict):
            broken.append("caption-not-an-object")
        else:
            text = caption.get("text")
            if not isinstance(text, str) or len(text) < 1:
                broken.append("caption-text-missing")
            elif len(text) > CAPTION_MAX_LENGTH:
                broken.append("caption-text-too-long")
            if not isinstance(caption.get("isFinal"), bool):
                broken.append("caption-isfinal-not-boolean")
            if set(caption) - {"text", "isFinal"}:
                broken.append("caption-invalid")

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
