"""Standard-library PNG reader and difference-hash fingerprinting.

Part 2's slide matcher and this pack's validator must agree on one fingerprint
definition without pulling an image library into CI. The reviewed decks are
written by `generate_slides.py` as 8-bit non-interlaced RGB PNGs, which is the
only shape this reader needs to handle.

The fingerprint is a row-wise difference hash over a 12x12 grid of block means:
GRID * (GRID - 1) = 132 bits. An 8x8 average hash was measured first and left
only 8 bits between the two closest reviewed slides, which is inside the noise
a rescaled capture introduces. The 12x12 difference hash leaves 40.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ALGORITHM = "dhash12"
GRID = 12
BITS = GRID * (GRID - 1)
HEX_DIGITS = (BITS + 3) // 4

# Two neighbouring cells inside one flat area of a slide have mean luminances
# that are equal, or equal to within floating-point noise. A bare `>` turns
# that tie into a coin flip decided by summation order, which made the hash
# differ between two implementations of the same reduction and made compression
# noise flip bits for free. Ties resolve to 0, and only a real difference of at
# least this many luminance levels (out of 255) sets a bit.
TIE_EPSILON = 0.75


class PngError(ValueError):
    """Raised when a file is not a PNG this reader supports."""


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def read_png(path: Path) -> tuple[int, int, int, bytes]:
    """Return (width, height, channels, raw pixel bytes) for an 8-bit PNG."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise PngError(f"{path} is not a PNG file")

    offset = 8
    header: tuple[int, int, int, int, int, int, int] | None = None
    idat = bytearray()
    while offset < len(data):
        (length,) = struct.unpack(">I", data[offset : offset + 4])
        kind = data[offset + 4 : offset + 8]
        body = data[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break

    if header is None:
        raise PngError(f"{path} has no IHDR chunk")
    width, height, depth, colour, compression, filtering, interlace = header
    if depth != 8 or compression != 0 or filtering != 0 or interlace != 0:
        raise PngError(f"{path} must be an 8-bit, non-interlaced PNG")
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(colour)
    if channels is None:
        raise PngError(f"{path} uses unsupported colour type {colour}")

    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(height * stride)
    previous = bytearray(stride)
    pos = 0
    for row in range(height):
        filter_type = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        if filter_type == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                line[i] = (line[i] + previous[i]) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif filter_type == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                upper_left = previous[i - channels] if i >= channels else 0
                line[i] = (line[i] + _paeth(left, previous[i], upper_left)) & 0xFF
        elif filter_type != 0:
            raise PngError(f"{path} row {row} uses unknown filter {filter_type}")
        out[row * stride : (row + 1) * stride] = line
        previous = line
    return width, height, channels, bytes(out)


def _block_means(path: Path) -> list[float]:
    """Reduce an image to GRID x GRID mean-luminance cells.

    Downscaling by block mean rather than by nearest neighbour keeps the hash
    stable across the small scaling differences a captured frame goes through.

    Sums run over strided `bytes` slices rather than a per-pixel Python loop:
    a cell's luminance total is a fixed combination of its per-channel totals,
    and each channel total is one C-level `sum`. On the 1280x720 demo slides
    that is the difference between a validator run of 40 seconds and one of 3.
    """
    width, height, channels, pixels = read_png(path)
    # Ceiling division, so a column's span is exactly the set of x where
    # `x * GRID // width == column` -- the same assignment a per-pixel loop makes.
    edges = [-(-column * width // GRID) for column in range(GRID)] + [width]
    columns = list(zip(edges, edges[1:]))

    totals = [0.0] * (GRID * GRID)
    counts = [0] * (GRID * GRID)
    for y in range(height):
        cell_y = min(GRID - 1, y * GRID // height)
        row_start = y * width * channels
        row = pixels[row_start : row_start + width * channels]
        for column, (left, right) in enumerate(columns):
            if right <= left:
                continue
            base = left * channels
            stop = right * channels
            if channels >= 3:
                total = (
                    0.299 * sum(row[base : stop : channels])
                    + 0.587 * sum(row[base + 1 : stop : channels])
                    + 0.114 * sum(row[base + 2 : stop : channels])
                )
            else:
                total = float(sum(row[base : stop : channels]))
            cell = cell_y * GRID + column
            totals[cell] += total
            counts[cell] += right - left
    return [total / count for total, count in zip(totals, counts)]


_CACHE: dict[tuple[str, int, int], str] = {}


def fingerprint(path: Path) -> str:
    """Return the reviewed `dhash12:<33 hex>` fingerprint for a slide image.

    Each bit records whether a cell is brighter than the cell to its right, so
    the hash tracks the slide's layout rather than its absolute exposure.
    """
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    cached = _CACHE.get(key)
    if cached is not None:
        return cached

    means = _block_means(path)
    bits = 0
    position = 0
    for row in range(GRID):
        for column in range(GRID - 1):
            bits <<= 1
            if means[row * GRID + column] > means[row * GRID + column + 1] + TIE_EPSILON:
                bits |= 1
            position += 1
    value = f"{ALGORITHM}:{bits:0{HEX_DIGITS}x}"
    _CACHE[key] = value
    return value


def hamming_distance(left: str, right: str) -> int:
    """Hamming distance between two fingerprints, in bits."""
    left_algorithm, _, left_bits = left.partition(":")
    right_algorithm, _, right_bits = right.partition(":")
    if left_algorithm != ALGORITHM or right_algorithm != ALGORITHM:
        raise ValueError(f"expected two {ALGORITHM} fingerprints, got {left} and {right}")
    return bin(int(left_bits, 16) ^ int(right_bits, 16)).count("1")
