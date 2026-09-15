"""Re-derive the matching thresholds in `deck.py` from measurement.

Puts every reviewed slide through the distortions a shared-screen capture
actually applies -- rescaling, JPEG compression, blur, a small crop, exposure
change -- and reports, for each distorted frame, how far it lands from its own
fingerprint and how much nearer it stays to that one than to any other slide.
Then does the same for the unapproved demo slide, which must be rejected.

Needs Pillow, so it is a development tool rather than a CI check. The numbers it
prints are the evidence behind `MATCH_MAX_HAMMING_DISTANCE` and
`MATCH_MIN_MARGIN`; rerun it whenever the deck changes and update those
constants if the headroom moves.

Usage:  python3 packages/access-packs/bio-cell-demo/tools/measure_matching.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))

import imagehash  # noqa: E402
from deck import MATCH_MAX_HAMMING_DISTANCE, MATCH_MIN_MARGIN, SLIDE_HEIGHT, SLIDE_WIDTH  # noqa: E402

PACK_ROOT = Path(__file__).resolve().parents[1]
SLIDES = PACK_ROOT / "slides"
DEMO_ASSETS = PACK_ROOT / "demo-assets"

CROP = (round(SLIDE_WIDTH * 0.02), round(SLIDE_HEIGHT * 0.02))

DISTORTIONS = {
    "downscale 640x360": lambda image: image.resize((640, 360), Image.LANCZOS),
    "downscale 480x270": lambda image: image.resize((480, 270), Image.LANCZOS),
    "upscale 1920x1080": lambda image: image.resize((1920, 1080), Image.LANCZOS),
    "jpeg quality 60": None,
    "gaussian blur r=2": lambda image: image.filter(ImageFilter.GaussianBlur(2)),
    "crop 2% border": lambda image: image.crop(
        (CROP[0], CROP[1], SLIDE_WIDTH - CROP[0], SLIDE_HEIGHT - CROP[1])
    ),
    "brighten +18%": lambda image: Image.eval(image, lambda value: min(255, int(value * 1.18))),
}


def _distort(source: Path, transform, workspace: Path) -> Path:
    image = Image.open(source).convert("RGB")
    target = workspace / "frame.png"
    if transform is None:
        jpeg = workspace / "frame.jpg"
        image.save(jpeg, quality=60)
        Image.open(jpeg).convert("RGB").save(target)
    else:
        transform(image).save(target)
    return target


def main() -> int:
    reference = {path.stem: imagehash.fingerprint(path) for path in sorted(SLIDES.glob("*.png"))}
    if not reference:
        raise SystemExit(f"no slides found in {SLIDES}")

    workspace = Path(tempfile.mkdtemp())
    worst_own = 0
    worst_margin = 10**6

    print(f"{imagehash.ALGORITHM}, {imagehash.BITS} bits, {len(reference)} reviewed slides\n")
    print("Reviewed slides under capture-style distortion:")
    print(f"  {'distortion':22s} {'max own distance':>16s} {'min margin':>11s}")
    for name, transform in DISTORTIONS.items():
        own_distances = []
        margins = []
        for path in sorted(SLIDES.glob("*.png")):
            fingerprint = imagehash.fingerprint(_distort(path, transform, workspace))
            own = imagehash.hamming_distance(fingerprint, reference[path.stem])
            other = min(
                imagehash.hamming_distance(fingerprint, value)
                for key, value in reference.items()
                if key != path.stem
            )
            own_distances.append(own)
            margins.append(other - own)
        worst_own = max(worst_own, max(own_distances))
        worst_margin = min(worst_margin, min(margins))
        print(f"  {name:22s} {max(own_distances):16d} {min(margins):11d}")

    print(f"\n  worst own distance across all distortions: {worst_own}")
    print(f"  worst margin across all distortions:       {worst_margin}")

    print("\nUnapproved content (must be rejected):")
    rejected = True
    for candidate in sorted(DEMO_ASSETS.glob("*.png")):
        fingerprint = imagehash.fingerprint(candidate)
        ranked = sorted(
            (imagehash.hamming_distance(fingerprint, value), key) for key, value in reference.items()
        )
        nearest, nearest_id = ranked[0]
        margin = ranked[1][0] - nearest
        accepted = nearest <= MATCH_MAX_HAMMING_DISTANCE and margin >= MATCH_MIN_MARGIN
        rejected &= not accepted
        verdict = "ACCEPTED (bad)" if accepted else "rejected"
        print(f"  {candidate.name}: nearest {nearest_id} at {nearest} bits, margin {margin} -> {verdict}")

    print(
        f"\nConfigured thresholds: maxHammingDistance={MATCH_MAX_HAMMING_DISTANCE}, "
        f"minMargin={MATCH_MIN_MARGIN}"
    )
    ok = worst_own <= MATCH_MAX_HAMMING_DISTANCE and worst_margin >= MATCH_MIN_MARGIN and rejected
    print("Thresholds accept every distorted reviewed capture and reject unapproved content."
          if ok else
          "THRESHOLDS DO NOT HOLD — adjust deck.py or make the slides more distinct.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
