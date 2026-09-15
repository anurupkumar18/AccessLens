"""Reviewed content for the `bio-cell-demo` Access Pack.

This module is the single source of truth for the pack's *meaning*: slide
titles, reading order, region geometry, and every student-facing sentence. The
slide renderer and the pack writer both read it, so a drawn highlight box and
the `bounds` a student renderer receives cannot drift apart.

Every `shortDescription` and `plainLanguage` string here is instructor-reviewed
introductory cell biology. Nothing in this file is generated at run time.
"""

from __future__ import annotations

from dataclasses import dataclass, field

PACK_ID = "bio-cell-demo"
PACK_VERSION = 1
SCHEMA_VERSION = "1.0"
TITLE = "Cell Structure"
MODEL_URI = "models/cell.glb"

SLIDE_WIDTH = 1280
SLIDE_HEIGHT = 720

# Matching policy the instructor-side matcher must apply. A captured frame
# matches a reviewed slide only when it is within MAX_HAMMING_DISTANCE bits of
# that slide's 132-bit fingerprint *and* at least MIN_MARGIN bits closer than
# every other slide in the pack. Otherwise the matcher emits `source.unmatched`.
#
# Both numbers come from measurement, not taste. `measure_matching.py` puts each
# reviewed slide through seven capture-style distortions (rescale, JPEG q60,
# blur, 2% crop, brightening): the worst frame still sits only 10 bits from its
# own fingerprint and stays 27 bits nearer to it than to any other slide. The
# unapproved demo slide sits 48 bits from its nearest reviewed slide with a
# 3-bit margin. 26 and 14 therefore accept every distorted reviewed capture with
# room to spare and reject the unapproved slide under either rule on its own.
MATCH_MAX_HAMMING_DISTANCE = 26
MATCH_MIN_MARGIN = 14


@dataclass(frozen=True)
class Region:
    region_id: str
    label: str
    # Normalized 0-1 bounds within the slide, as x, y, width, height.
    bounds: tuple[float, float, float, float]
    short_description: str
    plain_language: str
    node_name: str
    camera_target: str


@dataclass(frozen=True)
class Slide:
    asset_id: str
    title: str
    subtitle: str
    default_camera: str
    regions: list[Region]
    reading_order: list[str] = field(default_factory=list)

    def ordered_ids(self) -> list[str]:
        return self.reading_order or ["title"] + [r.region_id for r in self.regions]


# Named camera framings in the reviewed AR scene. Positions and targets are in
# model space (metres); the cell membrane has a radius of 1.0.
AR_CAMERAS: dict[str, dict[str, object]] = {
    "cell-overview": {"position": [0.0, 0.9, 3.4], "target": [0.0, 0.0, 0.0], "fov": 40},
    "nucleus-closeup": {"position": [-0.1, 0.5, 1.7], "target": [-0.22, 0.10, 0.0], "fov": 35},
    "mitochondrion-closeup": {"position": [0.95, 0.45, 1.5], "target": [0.38, 0.16, 0.10], "fov": 35},
    "secretory-path": {"position": [0.15, 0.85, 2.3], "target": [0.02, -0.18, 0.05], "fov": 38},
    "recycling-closeup": {"position": [-0.75, -0.35, 1.9], "target": [-0.40, -0.42, 0.05], "fov": 35},
}


DECK: list[Slide] = [
    Slide(
        asset_id="cell-slide-01",
        title="The Animal Cell",
        subtitle="An overview of the boundary, the interior, and the control centre",
        default_camera="cell-overview",
        reading_order=["title", "cell-membrane", "cytoplasm", "nucleus"],
        regions=[
            Region(
                region_id="cell-membrane",
                label="Cell membrane",
                bounds=(0.08, 0.22, 0.84, 0.66),
                short_description=(
                    "The cell membrane is the outer boundary of the cell. It controls "
                    "which substances enter and leave."
                ),
                plain_language="The outside edge of the cell. It decides what gets in and out.",
                node_name="CellMembrane",
                camera_target="cell-overview",
            ),
            Region(
                region_id="cytoplasm",
                label="Cytoplasm",
                bounds=(0.14, 0.28, 0.72, 0.54),
                short_description=(
                    "The cytoplasm is the fluid that fills the cell. The organelles sit "
                    "in it and move through it."
                ),
                plain_language="The liquid inside the cell. Everything else floats in it.",
                node_name="Cytoplasm",
                camera_target="cell-overview",
            ),
            Region(
                region_id="nucleus",
                label="Nucleus",
                bounds=(0.30, 0.38, 0.22, 0.30),
                short_description=(
                    "The nucleus holds the cell's DNA and directs which proteins the "
                    "cell makes."
                ),
                plain_language="The control centre. It stores the instructions for the cell.",
                node_name="Nucleus",
                camera_target="nucleus-closeup",
            ),
        ],
    ),
    Slide(
        asset_id="cell-slide-02",
        title="Inside the Nucleus",
        subtitle="Where the cell stores instructions and starts building ribosomes",
        default_camera="nucleus-closeup",
        reading_order=["title", "nucleus", "nucleolus"],
        regions=[
            Region(
                region_id="nucleus",
                label="Nucleus",
                bounds=(0.22, 0.24, 0.44, 0.60),
                short_description=(
                    "The nucleus is enclosed by a double membrane with pores that let "
                    "molecules pass between it and the cytoplasm."
                ),
                plain_language="The control centre has a wall with small openings in it.",
                node_name="Nucleus",
                camera_target="nucleus-closeup",
            ),
            Region(
                region_id="nucleolus",
                label="Nucleolus",
                bounds=(0.35, 0.42, 0.16, 0.22),
                short_description=(
                    "The nucleolus is a dense region inside the nucleus where ribosome "
                    "parts are assembled."
                ),
                plain_language="A dark spot inside the control centre. It builds ribosome parts.",
                node_name="Nucleolus",
                camera_target="nucleus-closeup",
            ),
        ],
    ),
    Slide(
        asset_id="cell-slide-03",
        title="Mitochondria and Energy",
        subtitle="Releasing usable energy from nutrients",
        default_camera="mitochondrion-closeup",
        reading_order=["title", "mitochondrion", "cytoplasm"],
        regions=[
            Region(
                region_id="mitochondrion",
                label="Mitochondrion",
                bounds=(0.35, 0.22, 0.18, 0.24),
                short_description=(
                    "The mitochondrion releases usable energy from nutrients and stores "
                    "it as ATP. Its inner membrane is folded to increase surface area."
                ),
                plain_language="This structure helps power the cell.",
                node_name="Mitochondrion",
                camera_target="mitochondrion-closeup",
            ),
            Region(
                region_id="cytoplasm",
                label="Cytoplasm",
                bounds=(0.10, 0.55, 0.80, 0.30),
                short_description=(
                    "The first stage of releasing energy from glucose happens in the "
                    "cytoplasm, before the mitochondrion finishes the process."
                ),
                plain_language="The first step of getting energy happens in the liquid part.",
                node_name="Cytoplasm",
                camera_target="cell-overview",
            ),
        ],
    ),
    Slide(
        asset_id="cell-slide-04",
        title="Building and Shipping Proteins",
        subtitle="Ribosome, rough endoplasmic reticulum, then Golgi apparatus",
        default_camera="secretory-path",
        reading_order=["title", "ribosome", "rough-er", "golgi-apparatus"],
        regions=[
            Region(
                region_id="ribosome",
                label="Ribosome",
                bounds=(0.08, 0.26, 0.20, 0.24),
                short_description=(
                    "Ribosomes read the instructions copied from DNA and join amino "
                    "acids into a protein chain."
                ),
                plain_language="Ribosomes put proteins together, one piece at a time.",
                node_name="Ribosome",
                camera_target="secretory-path",
            ),
            Region(
                region_id="rough-er",
                label="Rough endoplasmic reticulum",
                bounds=(0.37, 0.40, 0.26, 0.30),
                short_description=(
                    "The rough endoplasmic reticulum is studded with ribosomes. It "
                    "folds new proteins and passes them on in small vesicles."
                ),
                plain_language="A folded surface covered in ribosomes. It shapes new proteins.",
                node_name="RoughER",
                camera_target="secretory-path",
            ),
            Region(
                region_id="golgi-apparatus",
                label="Golgi apparatus",
                bounds=(0.70, 0.58, 0.22, 0.26),
                short_description=(
                    "The Golgi apparatus finishes, sorts, and packages proteins, then "
                    "sends them to where the cell needs them."
                ),
                plain_language="The packing and sending area for finished proteins.",
                node_name="GolgiApparatus",
                camera_target="secretory-path",
            ),
        ],
    ),
    Slide(
        asset_id="cell-slide-05",
        title="Breaking Down and Storing",
        subtitle="Lysosomes recycle materials; vacuoles hold them",
        default_camera="recycling-closeup",
        reading_order=["title", "lysosome", "vacuole"],
        regions=[
            Region(
                region_id="lysosome",
                label="Lysosome",
                bounds=(0.14, 0.30, 0.30, 0.36),
                short_description=(
                    "Lysosomes contain enzymes that break down worn-out cell parts and "
                    "material the cell has taken in."
                ),
                plain_language="Lysosomes break down old or unwanted parts of the cell.",
                node_name="Lysosome",
                camera_target="recycling-closeup",
            ),
            Region(
                region_id="vacuole",
                label="Vacuole",
                bounds=(0.56, 0.28, 0.32, 0.40),
                short_description=(
                    "Vacuoles are membrane-bound sacs that store water, nutrients, or "
                    "waste until the cell needs or removes them."
                ),
                plain_language="Vacuoles are storage bags inside the cell.",
                node_name="Vacuole",
                camera_target="recycling-closeup",
            ),
        ],
    ),
]


def slide_by_id(asset_id: str) -> Slide:
    for slide in DECK:
        if slide.asset_id == asset_id:
            return slide
    raise KeyError(f"unknown asset id: {asset_id}")


def all_node_names() -> list[str]:
    names: list[str] = []
    for slide in DECK:
        for region in slide.regions:
            if region.node_name not in names:
                names.append(region.node_name)
    return names
