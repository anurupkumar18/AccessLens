"""Minimal standard-library reader for the glTF-binary JSON chunk.

The validator needs one fact out of `cell.glb`: which node names exist, so a
hotspot cannot point at a model node that was renamed or removed. Reading the
JSON chunk is enough for that and keeps CI free of a glTF dependency.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path


class GlbError(ValueError):
    """Raised when a file is not a readable glTF 2.0 binary."""


def read_json_chunk(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 20:
        raise GlbError(f"{path} is too short to be a GLB")
    magic, version, total = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise GlbError(f"{path} is not a GLB file")
    if version != 2:
        raise GlbError(f"{path} is glTF version {version}; expected 2")
    if total != len(data):
        raise GlbError(f"{path} header length {total} does not match file size {len(data)}")

    offset = 12
    while offset < len(data):
        length, kind = struct.unpack_from("<I4s", data, offset)
        body = data[offset + 8 : offset + 8 + length]
        offset += 8 + length
        if kind == b"JSON":
            return json.loads(body.decode("utf-8"))
    raise GlbError(f"{path} has no JSON chunk")


def node_names(path: Path) -> list[str]:
    gltf = read_json_chunk(path)
    return [node["name"] for node in gltf.get("nodes", []) if "name" in node]
