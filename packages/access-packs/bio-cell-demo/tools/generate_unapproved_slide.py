"""Render the deliberately unapproved slide used in the demo's failure beat.

`DEMO_RUNBOOK.md` 2:00-2:30 requires opening a slide the pack has never
reviewed and showing `Unmatched` instead of an invented description. That slide
has to exist as a checked-in asset, and it must NOT live under `slides/` or be
listed in `pack.json` -- being absent from the pack is the whole point.

Usage:  python3 packages/access-packs/bio-cell-demo/tools/generate_unapproved_slide.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deck import SLIDE_HEIGHT, SLIDE_WIDTH  # noqa: E402

PACK_ROOT = Path(__file__).resolve().parents[1]
TARGET = PACK_ROOT / "demo-assets" / "unapproved-photosynthesis.png"
FONT_DIR = Path("/System/Library/Fonts/Supplemental")


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), size)


def main() -> int:
    image = Image.new("RGB", (SLIDE_WIDTH, SLIDE_HEIGHT), (26, 38, 30))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, SLIDE_WIDTH, 96), fill=(18, 26, 21))
    draw.text((64, 28), "Photosynthesis — Light Reactions", font=_font("Arial Bold.ttf", 44), fill=(226, 240, 228))

    # A dark slide with a bright right-hand diagram: a layout deliberately unlike
    # any reviewed cell slide, so the matcher has no near neighbour to latch on to.
    draw.rectangle((700, 150, 1216, 640), fill=(232, 246, 232))
    for index in range(4):
        y = 200 + index * 110
        draw.rectangle((740, y, 1176, y + 70), fill=(52, 128, 74), outline=(226, 240, 228), width=3)
        draw.text((760, y + 22), f"Stage {index + 1}", font=_font("Arial Bold.ttf", 28), fill=(255, 255, 255))
    body = _font("Arial.ttf", 26)
    for index, line in enumerate(
        [
            "Not part of the reviewed bio-cell-demo pack.",
            "AccessLens must report Unmatched for this slide",
            "and wait for the instructor to correct the source.",
        ]
    ):
        draw.text((64, 200 + index * 44), line, font=body, fill=(198, 220, 202))

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    image.save(TARGET, optimize=True)
    print(f"wrote {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
