"""Generate the reviewed AR cell model as an original glTF 2.0 binary.

Part 3 needs a `.glb` with stable node names it can look up by
`arScene.hotspots[].nodeName`. Rather than take on a third-party model's
licence for a hackathon demo, this writes original procedural geometry with
the standard library only: one ellipsoid per organelle, each its own named
node, mesh, and material.

Node translations are the same coordinates the named cameras in `deck.py`
target, so a camera framing and the structure it frames cannot drift apart.

Usage:  python3 packages/access-packs/bio-cell-demo/tools/generate_model.py
"""

from __future__ import annotations

import json
import math
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deck import all_node_names  # noqa: E402

PACK_ROOT = Path(__file__).resolve().parents[1]
TARGET = PACK_ROOT / "models" / "cell.glb"

RINGS = 14
SEGMENTS = 20


@dataclass(frozen=True)
class Organelle:
    node_name: str
    translation: tuple[float, float, float]
    scale: tuple[float, float, float]
    colour: tuple[float, float, float]
    alpha: float = 1.0


# Ordered outermost-inwards so a viewer reading the node list meets the cell
# boundary before its contents.
ORGANELLES: list[Organelle] = [
    Organelle("CellMembrane", (0.0, 0.0, 0.0), (1.00, 0.82, 0.86), (0.36, 0.55, 0.82), 0.22),
    Organelle("Cytoplasm", (0.0, 0.0, 0.0), (0.95, 0.77, 0.81), (0.78, 0.86, 0.95), 0.12),
    Organelle("Nucleus", (-0.22, 0.10, 0.00), (0.34, 0.34, 0.34), (0.42, 0.46, 0.78)),
    Organelle("Nucleolus", (-0.19, 0.13, 0.05), (0.12, 0.12, 0.12), (0.22, 0.24, 0.52)),
    Organelle("Mitochondrion", (0.38, 0.16, 0.10), (0.26, 0.14, 0.14), (0.86, 0.48, 0.24)),
    Organelle("Ribosome", (0.02, -0.30, 0.30), (0.06, 0.06, 0.06), (0.20, 0.62, 0.44)),
    Organelle("RoughER", (0.02, -0.18, 0.05), (0.34, 0.06, 0.26), (0.34, 0.72, 0.54)),
    Organelle("GolgiApparatus", (0.30, -0.34, -0.05), (0.22, 0.05, 0.18), (0.16, 0.52, 0.38)),
    Organelle("Lysosome", (-0.40, -0.42, 0.05), (0.13, 0.13, 0.13), (0.80, 0.34, 0.60)),
    Organelle("Vacuole", (-0.62, -0.18, -0.10), (0.20, 0.20, 0.20), (0.92, 0.80, 0.88), 0.55),
]


def unit_sphere() -> tuple[list[tuple[float, float, float]], list[tuple[float, float, float]], list[int]]:
    positions: list[tuple[float, float, float]] = []
    for ring in range(RINGS + 1):
        polar = math.pi * ring / RINGS
        for segment in range(SEGMENTS + 1):
            azimuth = 2.0 * math.pi * segment / SEGMENTS
            positions.append(
                (
                    math.sin(polar) * math.cos(azimuth),
                    math.cos(polar),
                    math.sin(polar) * math.sin(azimuth),
                )
            )
    indices: list[int] = []
    stride = SEGMENTS + 1
    for ring in range(RINGS):
        for segment in range(SEGMENTS):
            a = ring * stride + segment
            b = a + stride
            indices.extend([a, b, a + 1, a + 1, b, b + 1])
    # On a unit sphere centred at the origin the position is also the normal.
    return positions, list(positions), indices


def main() -> int:
    positions, normals, indices = unit_sphere()

    buffer = bytearray()
    views: list[dict[str, object]] = []
    accessors: list[dict[str, object]] = []

    def add_view(payload: bytes, target: int) -> int:
        while len(buffer) % 4:
            buffer.append(0)
        views.append({"buffer": 0, "byteOffset": len(buffer), "byteLength": len(payload), "target": target})
        buffer.extend(payload)
        return len(views) - 1

    position_view = add_view(b"".join(struct.pack("<3f", *p) for p in positions), 34962)
    normal_view = add_view(b"".join(struct.pack("<3f", *n) for n in normals), 34962)
    index_view = add_view(b"".join(struct.pack("<H", i) for i in indices), 34963)

    accessors.append(
        {
            "bufferView": position_view,
            "componentType": 5126,
            "count": len(positions),
            "type": "VEC3",
            "min": [-1.0, -1.0, -1.0],
            "max": [1.0, 1.0, 1.0],
        }
    )
    accessors.append(
        {"bufferView": normal_view, "componentType": 5126, "count": len(normals), "type": "VEC3"}
    )
    accessors.append(
        {"bufferView": index_view, "componentType": 5123, "count": len(indices), "type": "SCALAR"}
    )

    materials: list[dict[str, object]] = []
    meshes: list[dict[str, object]] = []
    nodes: list[dict[str, object]] = []
    for organelle in ORGANELLES:
        red, green, blue = organelle.colour
        materials.append(
            {
                "name": f"{organelle.node_name}Material",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [red, green, blue, organelle.alpha],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.65,
                },
                "alphaMode": "BLEND" if organelle.alpha < 1.0 else "OPAQUE",
                "doubleSided": organelle.alpha < 1.0,
            }
        )
        meshes.append(
            {
                "name": f"{organelle.node_name}Mesh",
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1},
                        "indices": 2,
                        "material": len(materials) - 1,
                    }
                ],
            }
        )
        nodes.append(
            {
                "name": organelle.node_name,
                "mesh": len(meshes) - 1,
                "translation": list(organelle.translation),
                "scale": list(organelle.scale),
            }
        )

    nodes.append({"name": "CellRoot", "children": list(range(len(ORGANELLES)))})

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "AccessLens bio-cell-demo generate_model.py",
            "copyright": "Original geometry for the AccessLens demo; CC0-1.0.",
        },
        "scene": 0,
        "scenes": [{"name": "ReviewedCell", "nodes": [len(nodes) - 1]}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(buffer)}],
    }

    json_chunk = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * (-len(json_chunk) % 4)
    bin_chunk = bytes(buffer)
    bin_chunk += b"\x00" * (-len(bin_chunk) % 4)

    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    glb = bytearray()
    glb += struct.pack("<4sII", b"glTF", 2, total)
    glb += struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk
    glb += struct.pack("<I4s", len(bin_chunk), b"BIN\x00") + bin_chunk

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(bytes(glb))

    missing = [name for name in all_node_names() if name not in {o.node_name for o in ORGANELLES}]
    if missing:
        raise SystemExit(f"deck references model nodes that do not exist: {missing}")
    print(f"wrote {TARGET} ({len(glb)} bytes, {len(nodes)} nodes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
