"""Contract and provenance validator for the `bio-cell-demo` Access Pack.

Standard library only: this runs in the documentation CI job that exists today,
before any JavaScript workspace or Zod contract has landed. When Part 1's
`packages/contracts/` is merged, the same `pack.json` should additionally be
validated there; this check stays as the provenance and asset-integrity half,
which a schema validator cannot do (it compares fingerprints against the actual
PNG bytes and hotspots against the actual model nodes).

Usage:  python3 packages/access-packs/bio-cell-demo/tools/validate_pack.py
Exit 0 when the pack is publishable, 1 with a list of problems otherwise.
"""

from __future__ import annotations

import json
import math
import sys
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import glb  # noqa: E402
import imagehash  # noqa: E402

PACK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PACK_ROOT.parents[2]
PACK_FILE = PACK_ROOT / "pack.json"
PROVENANCE = PACK_ROOT / "PROVENANCE.md"
DEMO_ASSETS = PACK_ROOT / "demo-assets"

# Charter invariants A5-A7: a pack carries reviewed instructional meaning and
# nothing about an individual student. Any key or key-like string from this list
# appearing anywhere in the pack is a hard failure, not a warning.
PROHIBITED_KEYS = (
    "diagnosis",
    "disability",
    "accommodation",
    "grade",
    "score",
    "mastery",
    "attention",
    "engagement",
    "emotion",
    "gaze",
    "studentid",
    "student_id",
    "email",
    "unid",
    "rawframe",
    "raw_frame",
    "screenshot",
    "framedata",
    "videourl",
    "audiorecording",
)

# Necessary structural guard: no two reviewed slides may sit closer together
# than twice the matcher's margin requirement. It is not sufficient on its own --
# `measure_matching.py` supplies the empirical evidence that distorted captures
# still land on the right slide -- but it catches a near-duplicate slide the
# moment someone adds one.
MIN_PAIRWISE_SEPARATION_FACTOR = 2

MAX_PLAIN_LANGUAGE_CHARS = 160
RESERVED_READING_ORDER = ("title",)


def _walk(node: object, path: str = "$"):
    if isinstance(node, dict):
        for key, value in node.items():
            yield f"{path}.{key}", key, value
            yield from _walk(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from _walk(value, f"{path}[{index}]")


def check_prohibited_fields(pack: dict) -> list[str]:
    errors = []
    for path, key, _ in _walk(pack):
        lowered = key.lower().replace("-", "")
        for prohibited in PROHIBITED_KEYS:
            if prohibited in lowered:
                errors.append(f"{path} uses prohibited field name '{key}' (matches '{prohibited}')")
    return errors


def check_top_level(pack: dict) -> list[str]:
    errors = []
    required = {
        "schemaVersion": str,
        "packId": str,
        "version": int,
        "title": str,
        "review": dict,
        "matching": dict,
        "arCameras": dict,
        "assets": list,
    }
    for field, kind in required.items():
        if field not in pack:
            errors.append(f"pack.json is missing required field '{field}'")
        elif not isinstance(pack[field], kind):
            errors.append(f"pack.json field '{field}' must be {kind.__name__}")
    if pack.get("schemaVersion") != "1.0":
        errors.append(f"pack.json schemaVersion must be '1.0', got {pack.get('schemaVersion')!r}")
    if isinstance(pack.get("version"), int) and pack["version"] < 1:
        errors.append("pack.json version must be 1 or greater")
    if not pack.get("assets"):
        errors.append("pack.json declares no assets")

    review = pack.get("review", {})
    if not isinstance(review, dict) or not review.get("reviewedBy"):
        errors.append("pack.json review.reviewedBy must name who reviewed the content")
    if review.get("externalSubjectMatterReview") is True and not review.get("notes"):
        errors.append("claiming external subject-matter review requires review.notes naming the reviewer")

    matching = pack.get("matching", {})
    if matching.get("algorithm") != imagehash.ALGORITHM:
        errors.append(
            f"matching.algorithm must be '{imagehash.ALGORITHM}', got {matching.get('algorithm')!r}"
        )
    if matching.get("hashBits") != imagehash.BITS:
        errors.append(f"matching.hashBits must be {imagehash.BITS}, got {matching.get('hashBits')!r}")
    if matching.get("onNoMatch") != "source.unmatched":
        errors.append("matching.onNoMatch must be 'source.unmatched'; unknown content is never described")
    for field in ("maxHammingDistance", "minMargin"):
        if not isinstance(matching.get(field), int) or matching[field] <= 0:
            errors.append(f"matching.{field} must be a positive integer")
    return errors


def check_cameras(pack: dict) -> list[str]:
    errors = []
    for name, camera in pack.get("arCameras", {}).items():
        if not isinstance(camera, dict):
            errors.append(f"arCameras.{name} must be an object")
            continue
        for field in ("position", "target"):
            value = camera.get(field)
            if not isinstance(value, list) or len(value) != 3 or not all(
                isinstance(component, (int, float)) for component in value
            ):
                errors.append(f"arCameras.{name}.{field} must be three numbers")
        fov = camera.get("fov")
        if not isinstance(fov, (int, float)) or not 10 <= fov <= 90:
            errors.append(f"arCameras.{name}.fov must be a number between 10 and 90")
    return errors


def check_assets(pack: dict) -> list[str]:
    errors: list[str] = []
    cameras = set(pack.get("arCameras", {}))
    seen_assets: set[str] = set()
    seen_hotspots: set[str] = set()
    model_nodes: dict[str, list[str]] = {}

    for asset in pack.get("assets", []):
        asset_id = asset.get("assetId", "<missing>")
        where = f"asset {asset_id}"
        if asset_id in seen_assets:
            errors.append(f"{where}: duplicate assetId")
        seen_assets.add(asset_id)
        if not asset.get("title"):
            errors.append(f"{where}: missing title")

        media = asset.get("mediaUri")
        if not media:
            errors.append(f"{where}: missing mediaUri")
        else:
            media_path = (PACK_ROOT / media).resolve()
            if not str(media_path).startswith(str(PACK_ROOT.resolve())):
                errors.append(f"{where}: mediaUri escapes the pack directory")
            elif not media_path.exists():
                errors.append(f"{where}: mediaUri {media} does not exist")
            else:
                actual = imagehash.fingerprint(media_path)
                if asset.get("fingerprint") != actual:
                    errors.append(
                        f"{where}: fingerprint {asset.get('fingerprint')} does not match "
                        f"{media} (recomputed {actual}); rerun generate_pack.py"
                    )

        region_ids: list[str] = []
        for region in asset.get("regions", []):
            region_id = region.get("regionId", "<missing>")
            spot = f"{where} region {region_id}"
            if region_id in region_ids:
                errors.append(f"{spot}: duplicate regionId within the asset")
            region_ids.append(region_id)
            bounds = region.get("bounds", {})
            missing = [k for k in ("x", "y", "width", "height") if k not in bounds]
            if missing:
                errors.append(f"{spot}: bounds missing {', '.join(missing)}")
            else:
                for key in ("x", "y", "width", "height"):
                    value = bounds[key]
                    if not isinstance(value, (int, float)) or not 0.0 <= value <= 1.0:
                        errors.append(f"{spot}: bounds.{key} must be normalized between 0 and 1")
                if bounds.get("width", 0) <= 0 or bounds.get("height", 0) <= 0:
                    errors.append(f"{spot}: bounds width and height must be greater than 0")
                if bounds.get("x", 0) + bounds.get("width", 0) > 1.0001:
                    errors.append(f"{spot}: bounds extend past the right edge of the slide")
                if bounds.get("y", 0) + bounds.get("height", 0) > 1.0001:
                    errors.append(f"{spot}: bounds extend past the bottom edge of the slide")
            if not region.get("label"):
                errors.append(f"{spot}: missing label")
            if not region.get("shortDescription"):
                errors.append(f"{spot}: missing shortDescription")
            plain = region.get("plainLanguage", "")
            if not plain:
                errors.append(f"{spot}: missing plainLanguage")
            elif len(plain) > MAX_PLAIN_LANGUAGE_CHARS:
                errors.append(
                    f"{spot}: plainLanguage is {len(plain)} characters; keep it under "
                    f"{MAX_PLAIN_LANGUAGE_CHARS} so the simplified route stays simpler"
                )

        reading_order = asset.get("readingOrder", [])
        if not reading_order:
            errors.append(f"{where}: missing readingOrder")
        for entry in reading_order:
            if entry not in RESERVED_READING_ORDER and entry not in region_ids:
                errors.append(f"{where}: readingOrder entry '{entry}' is not a region of this asset")
        if len(reading_order) != len(set(reading_order)):
            errors.append(f"{where}: readingOrder repeats an entry")
        for region_id in region_ids:
            if region_id not in reading_order:
                errors.append(
                    f"{where}: region '{region_id}' is missing from readingOrder, so the "
                    "structured-text route would skip it"
                )

        scene = asset.get("arScene", {})
        model_uri = scene.get("modelUri")
        if not model_uri:
            errors.append(f"{where}: arScene.modelUri is required; AR is a required renderer")
        else:
            model_path = (PACK_ROOT / model_uri).resolve()
            if not model_path.exists():
                errors.append(f"{where}: arScene.modelUri {model_uri} does not exist")
            elif model_uri not in model_nodes:
                try:
                    model_nodes[model_uri] = glb.node_names(model_path)
                except glb.GlbError as error:
                    errors.append(f"{where}: {error}")
                    model_nodes[model_uri] = []
        if scene.get("defaultCamera") not in cameras:
            errors.append(
                f"{where}: arScene.defaultCamera '{scene.get('defaultCamera')}' is not in arCameras"
            )

        hotspots = scene.get("hotspots", [])
        hotspot_regions: list[str] = []
        for hotspot in hotspots:
            hotspot_id = hotspot.get("hotspotId", "<missing>")
            spot = f"{where} hotspot {hotspot_id}"
            if hotspot_id in seen_hotspots:
                errors.append(f"{spot}: hotspotId is not unique across the pack")
            seen_hotspots.add(hotspot_id)
            region_id = hotspot.get("regionId")
            hotspot_regions.append(region_id)
            if region_id not in region_ids:
                errors.append(f"{spot}: regionId '{region_id}' is not a region of this asset")
            if not hotspot.get("label"):
                errors.append(f"{spot}: missing label; the AR route must expose the same name")
            node_name = hotspot.get("nodeName")
            known = model_nodes.get(model_uri, [])
            if known and node_name not in known:
                errors.append(f"{spot}: nodeName '{node_name}' is not a node in {model_uri}")
            if hotspot.get("cameraTarget") not in cameras:
                errors.append(f"{spot}: cameraTarget '{hotspot.get('cameraTarget')}' is not in arCameras")

        for region_id in region_ids:
            if region_id not in hotspot_regions:
                errors.append(
                    f"{where}: region '{region_id}' has no AR hotspot, so the AR route could not "
                    "reach the meaning the other routes show"
                )
        if len(hotspot_regions) != len(set(hotspot_regions)):
            errors.append(f"{where}: two hotspots claim the same region")

    return errors


def check_ar_framing(pack: dict) -> list[str]:
    """Every hotspot's camera must actually frame the structure it names.

    A camera aimed at empty space, or one whose organelle sits outside its field
    of view, is a bug nothing else here can see: the ids all resolve, the schema
    passes, and a student following the instructor to the mitochondrion is shown
    a view with no mitochondrion in it.

    The model has no rotations and a flat node list, so a node's translation is
    its position and the largest scale component is its radius. The test is
    whether the node's angular radius plus its off-axis angle from the camera's
    aim fits inside half the field of view.

    `fov` is treated as a single scalar with no aspect ratio, so this checks a
    cone rather than a rectangular frustum. That is conservative for a viewport
    wider than it is tall -- the real frame is larger horizontally -- and it is
    adequate for this model. A scene with rotations, nested transforms, or
    portrait viewports needs composed matrices and a per-axis field of view.
    """
    errors: list[str] = []
    cameras = pack.get("arCameras", {})
    transforms: dict[str, dict] = {}

    for asset in pack.get("assets", []):
        scene = asset.get("arScene", {})
        model_uri = scene.get("modelUri")
        if not model_uri:
            continue
        model_path = (PACK_ROOT / model_uri).resolve()
        if not model_path.exists():
            continue
        if model_uri not in transforms:
            try:
                transforms[model_uri] = glb.node_transforms(model_path)
            except glb.GlbError:
                continue
        nodes = transforms[model_uri]

        for hotspot in scene.get("hotspots", []):
            node = nodes.get(hotspot.get("nodeName"))
            camera = cameras.get(hotspot.get("cameraTarget"))
            if node is None or not isinstance(camera, dict):
                continue  # Already reported by check_assets.
            position = camera.get("position")
            target = camera.get("target")
            fov = camera.get("fov")
            if not (isinstance(position, list) and isinstance(target, list)):
                continue
            if not isinstance(fov, (int, float)):
                continue

            where = f"{asset['assetId']} hotspot {hotspot['hotspotId']}"
            centre = node["translation"]
            radius = max(abs(value) for value in node["scale"])

            to_target = [target[i] - position[i] for i in range(3)]
            to_node = [centre[i] - position[i] for i in range(3)]
            aim = math.dist(position, target)
            distance = math.dist(position, centre)

            if aim == 0:
                errors.append(f"{where}: camera '{hotspot['cameraTarget']}' sits on its own target")
                continue
            if distance <= radius:
                errors.append(
                    f"{where}: camera '{hotspot['cameraTarget']}' is inside node "
                    f"'{hotspot['nodeName']}' (distance {distance:.2f}, radius {radius:.2f})"
                )
                continue

            cosine = sum(to_target[i] * to_node[i] for i in range(3)) / (aim * distance)
            off_axis = math.degrees(math.acos(max(-1.0, min(1.0, cosine))))
            angular_radius = math.degrees(math.asin(min(1.0, radius / distance)))
            half_fov = fov / 2

            if off_axis + angular_radius > half_fov:
                errors.append(
                    f"{where}: node '{hotspot['nodeName']}' is not fully inside camera "
                    f"'{hotspot['cameraTarget']}' — it sits {off_axis:.1f} degrees off axis with "
                    f"an angular radius of {angular_radius:.1f}, needing {off_axis + angular_radius:.1f} "
                    f"of the {half_fov:.1f} available. A student sent here would not see it."
                )
    return errors


def check_fingerprint_separation(pack: dict) -> list[str]:
    matching = pack.get("matching", {})
    margin = matching.get("minMargin")
    if not isinstance(margin, int):
        return []
    required = MIN_PAIRWISE_SEPARATION_FACTOR * margin
    fingerprints = {
        asset["assetId"]: asset["fingerprint"]
        for asset in pack.get("assets", [])
        if asset.get("assetId") and asset.get("fingerprint")
    }
    errors = []
    for left, right in combinations(sorted(fingerprints), 2):
        distance = imagehash.hamming_distance(fingerprints[left], fingerprints[right])
        if distance < required:
            errors.append(
                f"slides {left} and {right} are only {distance} bits apart; the matcher needs at "
                f"least {required} to keep a {margin}-bit margin. Make the slides visually distinct."
            )
    return errors


def check_unapproved_assets_are_rejected(pack: dict) -> list[str]:
    """The demo's failure beat depends on unapproved content actually failing."""
    if not DEMO_ASSETS.exists():
        return []
    matching = pack.get("matching", {})
    ceiling = matching.get("maxHammingDistance")
    margin = matching.get("minMargin")
    if not isinstance(ceiling, int) or not isinstance(margin, int):
        return []
    fingerprints = {a["assetId"]: a["fingerprint"] for a in pack.get("assets", []) if a.get("fingerprint")}
    referenced = {a.get("mediaUri") for a in pack.get("assets", [])}

    errors = []
    for candidate in sorted(DEMO_ASSETS.glob("*.png")):
        relative = f"demo-assets/{candidate.name}"
        if relative in referenced:
            errors.append(f"{relative} is listed in pack.json; unapproved demo assets must stay out of the pack")
            continue
        fingerprint = imagehash.fingerprint(candidate)
        ranked = sorted(
            (imagehash.hamming_distance(fingerprint, value), key) for key, value in fingerprints.items()
        )
        if not ranked:
            continue
        nearest_distance, nearest_id = ranked[0]
        runner_up = ranked[1][0] if len(ranked) > 1 else nearest_distance + margin
        accepted = nearest_distance <= ceiling and (runner_up - nearest_distance) >= margin
        if accepted:
            errors.append(
                f"{relative} would match reviewed slide {nearest_id} at {nearest_distance} bits "
                f"(ceiling {ceiling}, margin {runner_up - nearest_distance}); the demo's Unmatched "
                "beat depends on this slide being rejected"
            )
    return errors


def check_provenance(pack: dict) -> list[str]:
    if not PROVENANCE.exists():
        return ["PROVENANCE.md is missing; every checked-in asset needs a recorded source and licence"]
    text = PROVENANCE.read_text(encoding="utf-8")
    errors = []
    binaries = sorted(
        path
        for pattern in ("slides/*.png", "models/*.glb", "demo-assets/*.png")
        for path in PACK_ROOT.glob(pattern)
    )
    for path in binaries:
        relative = path.relative_to(PACK_ROOT).as_posix()
        if relative not in text:
            errors.append(f"PROVENANCE.md does not record the source and licence of {relative}")
    for keyword in ("Licence", "Source"):
        if keyword not in text:
            errors.append(f"PROVENANCE.md has no '{keyword}' column or heading")
    return errors


def validate() -> list[str]:
    if not PACK_FILE.exists():
        return [f"{PACK_FILE} does not exist"]
    try:
        pack = json.loads(PACK_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        return [f"pack.json is not valid JSON: {error}"]

    errors = check_top_level(pack)
    errors += check_prohibited_fields(pack)
    errors += check_cameras(pack)
    errors += check_assets(pack)
    errors += check_ar_framing(pack)
    errors += check_fingerprint_separation(pack)
    errors += check_unapproved_assets_are_rejected(pack)
    errors += check_provenance(pack)
    return errors


def main() -> int:
    errors = validate()
    if errors:
        print(f"{PACK_FILE.relative_to(REPO_ROOT)} failed {len(errors)} check(s):")
        for error in errors:
            print(f"  - {error}")
        return 1
    pack = json.loads(PACK_FILE.read_text(encoding="utf-8"))
    regions = sum(len(asset["regions"]) for asset in pack["assets"])
    print(
        f"Validated {pack['packId']} v{pack['version']}: {len(pack['assets'])} reviewed assets, "
        f"{regions} regions, {regions} AR hotspots, {len(pack['arCameras'])} cameras."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
