"""Write `pack.json` from the reviewed deck content and the checked-in slides.

Standard library only, so it runs anywhere the validator runs. Fingerprints are
recomputed from the PNGs on disk, which is what keeps `pack.json` and `slides/`
from drifting apart: regenerate the slides, rerun this, and the pack follows.

Usage:  python3 packages/access-packs/bio-cell-demo/tools/generate_pack.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import imagehash  # noqa: E402
from deck import (  # noqa: E402
    AR_CAMERAS,
    DECK,
    MATCH_MAX_HAMMING_DISTANCE,
    MATCH_MIN_MARGIN,
    MODEL_URI,
    PACK_ID,
    PACK_VERSION,
    SCHEMA_VERSION,
    TITLE,
)

PACK_ROOT = Path(__file__).resolve().parents[1]
TARGET = PACK_ROOT / "pack.json"
RESERVED_READING_ORDER = ("title",)


def build() -> dict[str, object]:
    assets = []
    for slide in DECK:
        media = f"slides/{slide.asset_id}.png"
        assets.append(
            {
                "assetId": slide.asset_id,
                "mediaUri": media,
                "fingerprint": imagehash.fingerprint(PACK_ROOT / media),
                "title": slide.title,
                "subtitle": slide.subtitle,
                "readingOrder": slide.ordered_ids(),
                "regions": [
                    {
                        "regionId": region.region_id,
                        "label": region.label,
                        "bounds": {
                            "x": region.bounds[0],
                            "y": region.bounds[1],
                            "width": region.bounds[2],
                            "height": region.bounds[3],
                        },
                        "shortDescription": region.short_description,
                        "plainLanguage": region.plain_language,
                    }
                    for region in slide.regions
                ],
                "arScene": {
                    "modelUri": MODEL_URI,
                    "defaultCamera": slide.default_camera,
                    "hotspots": [
                        {
                            # Scoped by asset: several slides teach the same
                            # region (cytoplasm appears on 01 and 03), and
                            # `arState.hotspotId` has to resolve to exactly one
                            # hotspot pack-wide.
                            "hotspotId": f"{slide.asset_id}:{region.region_id}",
                            "regionId": region.region_id,
                            "nodeName": region.node_name,
                            "label": region.label,
                            "cameraTarget": region.camera_target,
                            "highlight": "outline",
                        }
                        for region in slide.regions
                    ],
                },
            }
        )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "packId": PACK_ID,
        "version": PACK_VERSION,
        "title": TITLE,
        "review": {
            "status": "internally-reviewed",
            "reviewedBy": "AccessLens content workstream (Part 5)",
            "reviewedAt": "2026-09-15",
            "externalSubjectMatterReview": False,
            "notes": (
                "Every student-facing sentence was written and checked against "
                "introductory cell-biology material by the content workstream. No "
                "external biology instructor or accessibility professional has "
                "signed off yet; implementation-plan task A15 tracks that review. "
                "Do not describe this pack as expert-reviewed until A15 closes."
            ),
        },
        "matching": {
            "algorithm": imagehash.ALGORITHM,
            "hashBits": imagehash.BITS,
            "maxHammingDistance": MATCH_MAX_HAMMING_DISTANCE,
            "minMargin": MATCH_MIN_MARGIN,
            "onNoMatch": "source.unmatched",
        },
        "arCameras": AR_CAMERAS,
        "reservedReadingOrderIds": list(RESERVED_READING_ORDER),
        "assets": assets,
    }


def main() -> int:
    TARGET.write_text(json.dumps(build(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {TARGET} ({len(DECK)} assets)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
