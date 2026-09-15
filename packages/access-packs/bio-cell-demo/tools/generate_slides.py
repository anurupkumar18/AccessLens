"""Render the reviewed biology deck to checked-in PNG slides.

Development-time tool. It needs Pillow; the validator and the tests that run in
CI do not. Every slide is drawn from primitives defined here, so the deck is
original artwork with no third-party licence attached (see `PROVENANCE.md`).

Usage:  python3 packages/access-packs/bio-cell-demo/tools/generate_slides.py
Then rerun `generate_pack.py` so the fingerprints in `pack.json` follow.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deck import DECK, SLIDE_HEIGHT, SLIDE_WIDTH, Slide  # noqa: E402

PACK_ROOT = Path(__file__).resolve().parents[1]
SLIDES = PACK_ROOT / "slides"

FONT_DIR = Path("/System/Library/Fonts/Supplemental")
INK = (24, 30, 42)
MUTED = (96, 108, 128)
RULE = (196, 204, 218)

PALETTE = {
    "cell-slide-01": (247, 249, 252),
    "cell-slide-02": (238, 242, 250),
    "cell-slide-03": (252, 246, 238),
    "cell-slide-04": (240, 250, 244),
    "cell-slide-05": (250, 240, 246),
}
ACCENT = {
    "cell-slide-01": (58, 104, 184),
    "cell-slide-02": (86, 76, 172),
    "cell-slide-03": (196, 96, 38),
    "cell-slide-04": (36, 132, 96),
    "cell-slide-05": (166, 58, 118),
}


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONT_DIR / name
    if not path.exists():
        raise SystemExit(f"missing font {path}; regenerate on a machine that has it")
    return ImageFont.truetype(str(path), size)


def _px(bounds: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    x, y, width, height = bounds
    return (
        round(x * SLIDE_WIDTH),
        round(y * SLIDE_HEIGHT),
        round((x + width) * SLIDE_WIDTH),
        round((y + height) * SLIDE_HEIGHT),
    )


def _chrome(draw: ImageDraw.ImageDraw, slide: Slide) -> None:
    accent = ACCENT[slide.asset_id]
    draw.rectangle((0, 0, SLIDE_WIDTH, 12), fill=accent)
    draw.text((64, 52), slide.title, font=_font("Arial Bold.ttf", 52), fill=INK)
    draw.text((64, 118), slide.subtitle, font=_font("Arial.ttf", 26), fill=MUTED)
    draw.line((64, 164, SLIDE_WIDTH - 64, 164), fill=RULE, width=2)
    footer = _font("Arial.ttf", 20)
    draw.text((64, SLIDE_HEIGHT - 44), "Cell Structure — reviewed demo deck", font=footer, fill=MUTED)
    number = f"{DECK.index(slide) + 1} / {len(DECK)}"
    draw.text(
        (SLIDE_WIDTH - 64 - draw.textlength(number, font=footer), SLIDE_HEIGHT - 44),
        number,
        font=footer,
        fill=MUTED,
    )


def _region_frame(draw: ImageDraw.ImageDraw, slide: Slide) -> None:
    """Outline each reviewed region so the drawn art matches the pack bounds.

    The label chip sits above the region where there is room under the header
    rule, and tucks inside the region's top-left corner where there is not, so
    a chip never lands on the title or on a neighbouring region's outline.
    """
    accent = ACCENT[slide.asset_id]
    label_font = _font("Arial Bold.ttf", 22)
    header_bottom = 176
    for region in slide.regions:
        box = _px(region.bounds)
        draw.rounded_rectangle(box, radius=14, outline=accent, width=3)
        width = draw.textlength(region.label, font=label_font) + 20
        if box[1] - 38 >= header_bottom:
            left, top = box[0], box[1] - 38
        else:
            left, top = box[0] + 10, box[1] + 10
        chip = (left, top, left + width, top + 30)
        draw.rounded_rectangle(chip, radius=8, fill=accent)
        draw.text((chip[0] + 10, chip[1] + 4), region.label, font=label_font, fill=(255, 255, 255))


def _slide_01(draw: ImageDraw.ImageDraw) -> None:
    draw.ellipse(_px((0.08, 0.22, 0.84, 0.66)), fill=(214, 228, 246), outline=(58, 104, 184), width=6)
    draw.ellipse(_px((0.14, 0.28, 0.72, 0.54)), fill=(232, 240, 251))
    draw.ellipse(_px((0.30, 0.38, 0.22, 0.30)), fill=(126, 158, 214), outline=(40, 72, 134), width=4)
    draw.ellipse(_px((0.36, 0.45, 0.08, 0.11)), fill=(40, 72, 134))
    for cx, cy in ((0.62, 0.40), (0.70, 0.58), (0.56, 0.66)):
        draw.ellipse(_px((cx, cy, 0.09, 0.07)), fill=(196, 128, 96), outline=(148, 84, 56), width=3)


def _slide_02(draw: ImageDraw.ImageDraw) -> None:
    draw.ellipse(_px((0.22, 0.24, 0.44, 0.60)), fill=(206, 208, 240), outline=(86, 76, 172), width=8)
    draw.ellipse(_px((0.245, 0.27, 0.39, 0.54)), fill=(226, 228, 248), outline=(86, 76, 172), width=4)
    draw.ellipse(_px((0.35, 0.42, 0.16, 0.22)), fill=(86, 76, 172))
    # Nuclear pores as gaps punched along the envelope.
    for index in range(10):
        angle = index / 10
        x = 0.44 + 0.225 * math.cos(angle * 2 * math.pi)
        y = 0.54 + 0.305 * math.sin(angle * 2 * math.pi)
        draw.ellipse(_px((x - 0.012, y - 0.021, 0.024, 0.042)), fill=(248, 248, 255))
    # Ribosome subunits assembled in the nucleolus, leaving through the pores.
    for x, y, radius in (
        (0.735, 0.33, 0.016), (0.795, 0.42, 0.013), (0.745, 0.51, 0.018),
        (0.830, 0.56, 0.012), (0.770, 0.64, 0.015), (0.855, 0.35, 0.011),
    ):
        draw.ellipse(
            _px((x - radius, y - radius * 16 / 9, radius * 2, radius * 2 * 16 / 9)),
            fill=(120, 110, 196),
        )


def _slide_03(draw: ImageDraw.ImageDraw) -> None:
    body = _px((0.35, 0.22, 0.18, 0.24))
    draw.ellipse(body, fill=(236, 186, 150), outline=(196, 96, 38), width=6)
    for index in range(5):
        offset = body[1] + 18 + index * ((body[3] - body[1] - 30) // 4)
        draw.arc((body[0] + 10, offset - 14, body[2] - 10, offset + 14), 200, 340, fill=(160, 74, 30), width=5)
    draw.rectangle(_px((0.10, 0.55, 0.80, 0.30)), fill=(250, 238, 224), outline=(214, 170, 132), width=3)
    arrow_y = round(0.70 * SLIDE_HEIGHT)
    draw.line((round(0.16 * SLIDE_WIDTH), arrow_y, round(0.80 * SLIDE_WIDTH), arrow_y), fill=(196, 96, 38), width=6)
    draw.polygon(
        [
            (round(0.84 * SLIDE_WIDTH), arrow_y),
            (round(0.80 * SLIDE_WIDTH), arrow_y - 16),
            (round(0.80 * SLIDE_WIDTH), arrow_y + 16),
        ],
        fill=(196, 96, 38),
    )


def _slide_04(draw: ImageDraw.ImageDraw) -> None:
    """A diagonal pathway: ribosome upper-left, ER centre, Golgi lower-right."""
    accent = ACCENT["cell-slide-04"]
    draw.ellipse(_px((0.08, 0.26, 0.20, 0.24)), fill=(196, 232, 212), outline=accent, width=6)
    for index in range(6):
        draw.ellipse(
            _px((0.115 + (index % 3) * 0.05, 0.32 + (index // 3) * 0.08, 0.03, 0.05)), fill=accent
        )

    box = _px((0.37, 0.40, 0.26, 0.30))
    draw.rectangle(box, fill=(214, 240, 226), outline=accent, width=5)
    for index in range(4):
        y = box[1] + 24 + index * ((box[3] - box[1] - 40) // 3)
        draw.line((box[0] + 16, y, box[2] - 16, y), fill=accent, width=7)

    golgi = _px((0.70, 0.58, 0.22, 0.26))
    for index in range(4):
        inset = index * 12
        draw.arc(
            (golgi[0] + inset, golgi[1] + inset, golgi[2] - inset, golgi[3] - inset),
            250, 470, fill=accent, width=8,
        )

    # Transport arrows along the pathway, so the diagonal reads as a sequence.
    for start, end in (((0.29, 0.40), (0.36, 0.48)), ((0.64, 0.62), (0.70, 0.68))):
        draw.line(
            (
                round(start[0] * SLIDE_WIDTH), round(start[1] * SLIDE_HEIGHT),
                round(end[0] * SLIDE_WIDTH), round(end[1] * SLIDE_HEIGHT),
            ),
            fill=accent, width=6,
        )
        draw.ellipse(
            _px((end[0] - 0.012, end[1] - 0.021, 0.024, 0.042)), fill=accent
        )


def _slide_05(draw: ImageDraw.ImageDraw) -> None:
    draw.ellipse(_px((0.14, 0.30, 0.30, 0.36)), fill=(242, 208, 228), outline=(166, 58, 118), width=6)
    for index in range(14):
        angle = index / 14 * 2 * math.pi
        x = 0.29 + 0.10 * math.cos(angle)
        y = 0.48 + 0.12 * math.sin(angle)
        draw.ellipse(_px((x - 0.008, y - 0.014, 0.016, 0.028)), fill=(166, 58, 118))
    draw.ellipse(_px((0.56, 0.28, 0.32, 0.40)), fill=(248, 232, 242), outline=(166, 58, 118), width=10)
    draw.ellipse(_px((0.61, 0.34, 0.22, 0.28)), fill=(252, 244, 249))


RENDERERS = {
    "cell-slide-01": _slide_01,
    "cell-slide-02": _slide_02,
    "cell-slide-03": _slide_03,
    "cell-slide-04": _slide_04,
    "cell-slide-05": _slide_05,
}


def render(slide: Slide) -> Image.Image:
    image = Image.new("RGB", (SLIDE_WIDTH, SLIDE_HEIGHT), PALETTE[slide.asset_id])
    draw = ImageDraw.Draw(image)
    RENDERERS[slide.asset_id](draw)
    _chrome(draw, slide)
    _region_frame(draw, slide)
    return image


def main() -> int:
    SLIDES.mkdir(parents=True, exist_ok=True)
    for slide in DECK:
        target = SLIDES / f"{slide.asset_id}.png"
        render(slide).save(target, optimize=True)
        print(f"wrote {target.relative_to(PACK_ROOT.parents[2])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
