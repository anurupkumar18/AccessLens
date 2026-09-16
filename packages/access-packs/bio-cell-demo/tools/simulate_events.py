"""Event-sequence simulator for the `bio-cell-demo` Access Pack.

Parts 2, 3, and 4 each need an ordered stream of `LiveEvent` objects before the
other two exist: Part 3 replays one to drive its renderers with no instructor or
AWS in the loop, Part 4 replays one through fixture WebSocket clients with no
browser, and Part 2 compares what its matcher emits against one.

Every event is built from `pack.json`, so a fixture cannot reference an asset,
region, or hotspot the reviewed pack does not contain -- which is the failure
mode that would otherwise surface as an invented description on a student's
screen.

Usage:
  python3 tools/simulate_events.py --list
  python3 tools/simulate_events.py --scenario happy-path
  python3 tools/simulate_events.py --scenario happy-path --stream --speed 4
  python3 tools/simulate_events.py --write-fixtures
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

PACK_ROOT = Path(__file__).resolve().parents[1]
PACK_FILE = PACK_ROOT / "pack.json"
FIXTURES = PACK_ROOT / "fixtures"

SCHEMA_VERSION = "1.0"
SESSION_ID = "sess-demo-0001"
START = datetime(2026, 9, 15, 15, 0, 0, tzinfo=timezone.utc)
STEP = timedelta(seconds=6)

EVENT_TYPES = (
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


class Builder:
    """Assigns monotonic sequence numbers and timestamps to reviewed events."""

    def __init__(self, pack: dict, session_id: str = SESSION_ID) -> None:
        self.pack = pack
        self.session_id = session_id
        self.sequence = 0
        self.clock = START
        self.events: list[dict] = []
        # Indices into `events` that are transport redeliveries of an earlier
        # event rather than new instructor actions.
        self.redelivered_indices: list[int] = []

    def _assets(self) -> dict[str, dict]:
        return {asset["assetId"]: asset for asset in self.pack["assets"]}

    def emit(self, event_type: str, **fields) -> dict:
        if event_type not in EVENT_TYPES:
            raise ValueError(f"{event_type} is not an allowlisted event type")
        self.sequence += 1
        self.clock += STEP
        event = {
            "schemaVersion": SCHEMA_VERSION,
            "type": event_type,
            "sessionId": self.session_id,
            "packId": self.pack["packId"],
            "packVersion": self.pack["version"],
            **fields,
            "sequence": self.sequence,
            "sentAt": self.clock.isoformat().replace("+00:00", "Z"),
        }
        self.events.append(event)
        return event

    def asset_changed(self, asset_id: str) -> dict:
        """Emit an asset change.

        No `arState`: the shared contract forbids it on this type, correctly.
        An asset change resets the scene, and the framing to reset to is
        `arScene.defaultCamera` in the pack -- reviewed content the renderer
        already holds, not something every event needs to restate.
        """
        self._assets()[asset_id]  # Raises if the pack does not contain it.
        return self.emit("asset.changed", assetId=asset_id)

    def region_changed(self, asset_id: str, region_id: str, pointer: tuple[float, float] | None = None) -> dict:
        asset = self._assets()[asset_id]
        hotspot = next(h for h in asset["arScene"]["hotspots"] if h["regionId"] == region_id)
        fields: dict = {
            "assetId": asset_id,
            "regionId": region_id,
            # No `camera` here either. The renderer resolves the hotspot in the
            # pack and reads its `cameraTarget`; duplicating it on the wire
            # would let the event and the reviewed pack disagree.
            "arState": {"hotspotId": hotspot["hotspotId"], "action": "focus"},
        }
        if pointer is not None:
            fields["pointer"] = {"x": pointer[0], "y": pointer[1]}
        return self.emit("region.changed", **fields)


def _region_centre(pack: dict, asset_id: str, region_id: str) -> tuple[float, float]:
    asset = next(a for a in pack["assets"] if a["assetId"] == asset_id)
    region = next(r for r in asset["regions"] if r["regionId"] == region_id)
    bounds = region["bounds"]
    return (
        round(bounds["x"] + bounds["width"] / 2, 3),
        round(bounds["y"] + bounds["height"] / 2, 3),
    )


def scenario_happy_path(pack: dict) -> tuple[Builder, list[str]]:
    """The demo's five scripted slide changes, ending on the mitochondrion beat."""
    builder = Builder(pack)
    builder.emit("session.started")
    for asset in pack["assets"]:
        asset_id = asset["assetId"]
        builder.asset_changed(asset_id)
        for region in asset["regions"]:
            builder.region_changed(
                asset_id, region["regionId"], _region_centre(pack, asset_id, region["regionId"])
            )
    builder.emit("session.ended")
    return builder, [
        "Every renderer updates from the same ordered stream with no extra input.",
        "Selecting region 'mitochondrion' on cell-slide-03 focuses AR node 'Mitochondrion'.",
        "Sequence numbers increase by exactly 1 and never repeat.",
        "Each region.changed names a hotspot that exists in the pack.",
    ]


def scenario_unmatched_and_correction(pack: dict) -> tuple[Builder, list[str]]:
    """The 2:00-2:30 failure beat: unknown slide, then instructor correction."""
    builder = Builder(pack)
    builder.emit("session.started")
    builder.asset_changed("cell-slide-03")
    builder.region_changed("cell-slide-03", "mitochondrion", _region_centre(pack, "cell-slide-03", "mitochondrion"))
    # Base fields only. Why the match failed and whether correction is offered
    # are instructor-side UI concerns; neither belongs on the wire, and the
    # shared contract now forbids them on this type.
    builder.emit("source.unmatched")
    builder.asset_changed("cell-slide-04")
    builder.region_changed("cell-slide-04", "rough-er", _region_centre(pack, "cell-slide-04", "rough-er"))
    builder.emit("session.ended")
    return builder, [
        "source.unmatched carries no assetId, regionId, description, or arState.",
        "Student renderers show an unmatched state and keep showing it until a reviewed asset arrives.",
        "No renderer invents a description for the unmatched slide (charter A9).",
        "The instructor correction arrives as an ordinary asset.changed, not a special event type.",
    ]


def scenario_stale_and_reordered(pack: dict) -> tuple[Builder, list[str]]:
    """Out-of-order delivery. Consumers must keep the newer state."""
    builder = Builder(pack)
    builder.emit("session.started")
    builder.asset_changed("cell-slide-01")
    builder.region_changed("cell-slide-01", "nucleus", _region_centre(pack, "cell-slide-01", "nucleus"))
    current = builder.region_changed(
        "cell-slide-01", "cell-membrane", _region_centre(pack, "cell-slide-01", "cell-membrane")
    )

    # A delayed duplicate of the earlier nucleus event, replayed after the
    # membrane event. Its sequence number is lower, so it must be dropped.
    stale = dict(builder.events[2])
    stale["sentAt"] = current["sentAt"]
    builder.events.append(stale)

    # A second copy of a sequence number already delivered.
    replay = dict(current)
    builder.events.append(replay)

    builder.sequence = current["sequence"]
    builder.emit("session.ended")
    return builder, [
        "Event 5 repeats sequence 3 after sequence 4; consumers drop it and keep cell-membrane focused.",
        "Event 6 repeats sequence 4 exactly; applying it twice must be indistinguishable from once.",
        "Part 4 rejects both at the relay; Part 3 must also drop them locally in case one slips through.",
        "No renderer may roll back to the nucleus region.",
    ]


def scenario_pause_resume_stop(pack: dict) -> tuple[Builder, list[str]]:
    """Instructor pauses, resumes, then stops; student views follow immediately."""
    builder = Builder(pack)
    builder.emit("session.started")
    builder.asset_changed("cell-slide-02")
    builder.region_changed("cell-slide-02", "nucleolus", _region_centre(pack, "cell-slide-02", "nucleolus"))
    builder.emit("capture.paused")
    builder.emit("capture.resumed")
    builder.region_changed("cell-slide-02", "nucleus", _region_centre(pack, "cell-slide-02", "nucleus"))
    builder.emit("capture.stopped")
    builder.emit("session.started")
    builder.region_changed("cell-slide-02", "nucleus", _region_centre(pack, "cell-slide-02", "nucleus"))
    builder.emit("session.ended")
    return builder, [
        "capture.paused freezes the student view immediately and shows a visible paused state.",
        "No region.changed may appear between capture.paused and capture.resumed.",
        "capture.stopped freezes the last reviewed moment but leaves the temporary session open for a later explicit Start.",
        "A later session.started resumes the same join code and monotonic event stream.",
        "session.ended closes the live view; later events for this session are refused.",
    ]


def scenario_reconnect(pack: dict) -> tuple[Builder, list[str]]:
    """A student drops off and is caught up with latest state, not a replay."""
    builder = Builder(pack)
    builder.emit("session.started")
    builder.asset_changed("cell-slide-04")
    builder.region_changed("cell-slide-04", "ribosome", _region_centre(pack, "cell-slide-04", "ribosome"))
    builder.region_changed("cell-slide-04", "golgi-apparatus", _region_centre(pack, "cell-slide-04", "golgi-apparatus"))
    # A student that missed sequences 3 and 4 rejoins and is sent only the
    # latest semantic state, not the history. The redelivery is a transport
    # fact, so it is recorded against the fixture rather than stamped on the
    # event -- a redelivered event must be byte-identical to the original, or
    # consumers cannot treat re-applying it as a no-op.
    builder.events.append(dict(builder.events[-1]))
    builder.redelivered_indices.append(len(builder.events) - 1)
    builder.emit("session.ended")
    return builder, [
        "A reconnecting student receives only the latest state, never a replay of the whole session.",
        "Applying the redelivered event produces the same view as having received sequence 4 live.",
        "The view is marked stale from disconnect until the redelivered event arrives.",
    ]


def scenario_captions(pack: dict) -> tuple[Builder, list[str]]:
    """Live captions arrive alongside, and never replace, reviewed descriptions."""
    builder = Builder(pack)
    builder.emit("session.started")
    builder.asset_changed("cell-slide-03")
    builder.region_changed("cell-slide-03", "mitochondrion", _region_centre(pack, "cell-slide-03", "mitochondrion"))
    for text in (
        "The mitochondrion is where most of the cell's usable energy is released.",
        "Notice the folded inner membrane; the folds increase the surface area.",
    ):
        builder.emit("caption.appended", assetId="cell-slide-03", caption={"text": text, "isFinal": True})
    builder.emit("session.ended")
    return builder, [
        "Captions are additive; they never replace the reviewed region description.",
        "Audio mode speaks only when the student asks, even while captions arrive (charter A8).",
        "Caption text is instructor speech, not a pack description, and is labelled as such.",
    ]


SCENARIOS = {
    "happy-path": scenario_happy_path,
    "unmatched-and-correction": scenario_unmatched_and_correction,
    "stale-and-reordered": scenario_stale_and_reordered,
    "pause-resume-stop": scenario_pause_resume_stop,
    "reconnect-latest-state": scenario_reconnect,
    "captions": scenario_captions,
}


def build(name: str, pack: dict) -> dict:
    builder, expectations = SCENARIOS[name](pack)
    return {
        "scenario": name,
        "description": (SCENARIOS[name].__doc__ or "").strip().splitlines()[0],
        "packId": pack["packId"],
        "packVersion": pack["version"],
        "sessionId": builder.session_id,
        "redeliveredEventIndices": builder.redelivered_indices,
        "expectations": expectations,
        "events": builder.events,
    }


# Negative fixtures. Each one is a valid-looking event with exactly one thing
# wrong, so a consumer's rejection message can be traced to a single cause.
def invalid_fixtures(pack: dict) -> dict[str, dict]:
    base = {
        "schemaVersion": SCHEMA_VERSION,
        "type": "region.changed",
        "sessionId": SESSION_ID,
        "packId": pack["packId"],
        "packVersion": pack["version"],
        "assetId": "cell-slide-03",
        "regionId": "mitochondrion",
        "arState": {"hotspotId": "cell-slide-03:mitochondrion", "action": "focus"},
        "sequence": 7,
        "sentAt": "2026-09-15T15:00:42Z",
    }

    def variant(**overrides) -> dict:
        event = json.loads(json.dumps(base))
        event.update(overrides)
        return event

    return {
        "raw-frame-payload": {
            "expectedRule": "field-not-on-contract:frameData",
            "reason": "Carries screen pixels. The event contract has no field for a raw frame (charter A2).",
            "event": variant(frameData="iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"),
        },
        "unknown-event-type": {
            "expectedRule": "event-type-not-allowlisted",
            "reason": "Event type is not on the allowlist in SYSTEM_DESIGN section 6.",
            "event": variant(type="student.progress"),
        },
        "pointer-out-of-range": {
            "expectedRule": "pointer-out-of-range:x",
            "reason": "Pointer coordinates must be normalized between 0 and 1.",
            "event": variant(pointer={"x": 1.42, "y": 0.31}),
        },
        "unknown-region": {
            "expectedRule": "region-not-in-pack",
            "reason": "regionId is not a region of cell-slide-03 in this pack version.",
            "event": variant(regionId="chloroplast", arState={"hotspotId": "cell-slide-03:chloroplast", "action": "focus"}),
        },
        "hotspot-region-mismatch": {
            "expectedRule": "hotspot-region-mismatch",
            "reason": "arState.hotspotId belongs to a different region than regionId.",
            "event": variant(arState={"hotspotId": "cell-slide-03:cytoplasm", "action": "focus"}),
        },
        "pack-version-mismatch": {
            "expectedRule": "pack-version-mismatch",
            "reason": "packVersion does not match the reviewed pack; rendering must stop and refetch.",
            "event": variant(packVersion=pack["version"] + 1),
        },
        "student-published-instructor-event": {
            "expectedRule": "field-not-on-contract:publishedBy",
            "reason": "Published with a student capability. Only the instructor may emit region.changed.",
            "event": variant(publishedBy="student"),
        },
        "non-monotonic-sequence": {
            "expectedRule": "sequence-not-monotonic",
            "reason": "Sequence number goes backwards relative to the delivered stream.",
            "event": variant(sequence=2),
        },
        "prohibited-mastery-signal": {
            "expectedRule": "field-not-on-contract:masteryEstimate",
            "reason": "Carries a learner inference. No grade, mastery, or attention signal may exist (charter A7).",
            "event": variant(masteryEstimate=0.62),
        },
        "prohibited-student-identity": {
            "expectedRule": "field-not-on-contract:studentId",
            "reason": "Identifies an individual student. Events carry instructional state only.",
            "event": variant(studentId="student-00417"),
        },
    }


def write_fixtures(pack: dict) -> list[Path]:
    written = []
    FIXTURES.mkdir(parents=True, exist_ok=True)
    (FIXTURES / "invalid").mkdir(parents=True, exist_ok=True)
    for name in SCENARIOS:
        path = FIXTURES / f"{name}.json"
        path.write_text(json.dumps(build(name, pack), indent=2) + "\n", encoding="utf-8")
        written.append(path)
    for name, payload in invalid_fixtures(pack).items():
        path = FIXTURES / "invalid" / f"{name}.json"
        payload = {
            "fixture": name,
            "mustBeRejected": True,
            # The stream position these events are judged against: sequence 6
            # has already been delivered for this session.
            "lastDeliveredSequence": 6,
            **payload,
        }
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        written.append(path)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), help="print one scenario as JSON")
    parser.add_argument("--list", action="store_true", help="list the available scenarios")
    parser.add_argument("--stream", action="store_true", help="emit one event per line, paced by sentAt")
    parser.add_argument("--speed", type=float, default=1.0, help="stream speed multiplier (default 1.0)")
    parser.add_argument("--write-fixtures", action="store_true", help="regenerate fixtures/")
    arguments = parser.parse_args()

    pack = json.loads(PACK_FILE.read_text(encoding="utf-8"))

    if arguments.list or not (arguments.scenario or arguments.write_fixtures):
        for name, function in SCENARIOS.items():
            summary = (function.__doc__ or "").strip().splitlines()[0]
            print(f"{name:26s} {summary}")
        return 0

    if arguments.write_fixtures:
        for path in write_fixtures(pack):
            print(f"wrote {path.relative_to(PACK_ROOT)}")
        return 0

    payload = build(arguments.scenario, pack)
    if not arguments.stream:
        print(json.dumps(payload, indent=2))
        return 0

    previous: datetime | None = None
    for event in payload["events"]:
        current = datetime.fromisoformat(event["sentAt"].replace("Z", "+00:00"))
        if previous is not None and arguments.speed > 0:
            time.sleep((current - previous).total_seconds() / arguments.speed)
        previous = current
        print(json.dumps(event), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
