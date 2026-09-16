# Screen source: fingerprint contract and matcher

This directory is Part 2's screen source (implementation-plan A3 explicit
capture and A4 mock slide matcher). It is the only code that touches raw
frames, and a frame lives for exactly one `sampleFrame()` to fingerprint pass.
Everything downstream (controller, panel, events) holds strings and IDs only.

## The `fingerprint` field

`AccessPack.assets[].fingerprint` is the **`dhash12`** difference hash defined
by Part 5's reviewed pack in
`packages/access-packs/bio-cell-demo/tools/imagehash.py`. Part 2 originally
shipped a 64-bit `dhash-v1`; when Part 5 landed with `dhash12` the two
contracts collided and `dhash12` won on evidence (finer grid, tie epsilon,
40 bits between the closest reviewed slides where `dhash-v1` had 15).
`fingerprint.ts` is a line-for-line port and `fingerprint.test.ts` proves it
reproduces every fingerprint in the reviewed pack byte for byte; the Python
and TypeScript implementations were also cross-checked on the synthetic
slides (8 of 8 identical).

```text
dhash12:<thirty-three lowercase hexadecimal characters>
```

`isFingerprint()` is the format check; `assertPackFingerprints()` rejects a
pack whose assets carry anything else or whose `matching.algorithm` names
another hash, so a pack that skipped the CLI fails at controller construction
rather than silently never matching.

### Algorithm (exact)

1. **Luminance.** Rec. 601 on 8-bit RGB: `0.299 R + 0.587 G + 0.114 B`.
   Alpha is ignored.
2. **Grid.** 12 columns by 12 rows of block means over the full frame, no
   cropping. Column `c` spans pixel columns `ceil(c * width / 12)` to
   `ceil((c + 1) * width / 12) - 1`; a pixel row `y` belongs to grid row
   `min(11, floor(y * 12 / height))`. Each cell's value is the mean luminance
   of every pixel in it.
3. **Bits.** For each of the 12 rows, for each of the 11 adjacent column pairs
   left to right, emit `1` only when the left mean exceeds the right mean by
   more than `TIE_EPSILON = 0.75` luminance levels, else `0`. Flat areas
   therefore resolve to `0` deterministically instead of a coin flip. 132 bits.
4. **Pack.** Row-major, most significant bit first, 33 hex digits, zero padded.

Comparison is Hamming distance (0 to 132).

### Matching rule and where the thresholds live

`matchFingerprint(fingerprint, pack, options = matchOptionsFor(pack))`:

- Distance from the frame to every asset.
- **Matched** only when the nearest asset is at or below `threshold` **and**
  every other asset is at least `margin` bits farther away.
- Otherwise **unmatched** (`no-candidate` or `ambiguous`).

Thresholds are reviewed content, not compiled constants: `matchOptionsFor`
reads `pack.matching.maxHammingDistance` and `pack.matching.minMargin`. The
reviewed bio-cell-demo pack carries 26 and 14, measured by Part 5's
`tools/measure_matching.py` across downscale, upscale, and noise distortions.
`DEFAULT_MATCH_OPTIONS` mirrors those two numbers for packs without a
`matching` block; `scripts/build-pack.ts` writes the block into every pack it
generates.

### Evidence

Synthetic fixtures (clean 1920x1080 renders and 1280x720 demo-condition
variants with brightness shift, bezel, and block noise), `dhash12`:

| demo frame | own asset | nearest other | decision |
| --- | --- | --- | --- |
| slide-01 | 2 | slide-04 57 | matched |
| slide-02 | 12 | slide-05 50 | matched |
| slide-03 | 9 | slide-06 52 | matched |
| slide-04 | 6 | slide-01 57 | matched |
| slide-05 | 13 | slide-02 49 | matched |
| slide-06 | 7 | slide-03 50 | matched |
| solid black or white | 65 (slide-01) | 68 | unmatched, no-candidate |
| unknown-01 (clean) | 49 (slide-05) | 50 | unmatched, no-candidate |
| twin-a / twin-b (clean) | 0 | 0 | unmatched, ambiguous |

Real deck (`packs/hnsw`, eight LibreOffice-rendered PowerPoint slides), clean
pairwise minimum: **16 bits** between slides 04 and 05, which share a layout.
Under `dhash-v1` that pair was 7. With threshold 26 and margin 14 a live
capture of either slide will still land as Unmatched when its own distance
exceeds about 2 bits, so same-template slides remain the case the instructor
corrects by hand. Everything else in that deck is 24 bits or more apart.

### Known limitation for real slides

Same-template slides (identical diagram, different bullets) are the residual
weak spot. When a real deck shows a pair under roughly `threshold + margin`
bits apart, prefer changing the slides (a page-number block, a coloured band,
a different diagram crop) over loosening the thresholds; if the thresholds
must move, rerun Part 5's `measure_matching.py` and record the table in the
pack's `matching` block and here.

## Producing fingerprints for a pack (Part 5 workflow)

```sh
npx tsx scripts/fingerprint-pack.ts <pack.json> <slides-dir> [--out <path>]
```

- `<pack.json>`: an Access Pack whose `assets[].fingerprint` may hold any
  placeholder string.
- `<slides-dir>`: a directory holding one PNG per asset, named
  `<assetId>.png`, exported at the slide's native resolution (any size; the
  hash is resolution independent).
- The CLI prints `assetId<TAB>fingerprint` for each asset, validates the
  result with `AccessPackSchema`, and writes 2-space JSON with a trailing
  newline. Without `--out` it rewrites the pack in place; re-running on
  unchanged slides is a byte-for-byte no-op (the test suite asserts this for
  the synthetic pack).

Regenerate the synthetic fixtures with
`npx tsx scripts/generate-slide-fixtures.ts` (deterministic; output is
byte-identical run to run).

## Building a pack from a deck with no hand authoring

```sh
npx tsx scripts/build-pack.ts ~/Downloads/deck.pptx --pack-id my-deck --title "My Deck" --out packs/my-deck
```

LibreOffice renders the deck to PDF, pdftoppm renders 1920-wide PNGs, Claude
Sonnet 4.6 on Bedrock (`us-east-1`, live AWS credentials required) describes
each slide through a strict tool call, fingerprints are computed, and
`<out>/pack.draft.json` is written with a `matching` block and validated
against `AccessPackSchema`. Per-slide descriptions are cached beside the PNGs
(`--redo` forces regeneration). The file is a **draft** until an instructor
reads every sentence and renames it to `pack.json` (charter A3).

## Module map

| File | Role |
| --- | --- |
| `index.ts` | Public surface. Tests and the instructor module import only from here. |
| `fingerprint.ts` | Pure: `Frame` to `dhash12` string; Hamming distance; format check. Port of Part 5's `imagehash.py`. |
| `matcher.ts` | Pure: fingerprint to `MatchDecision`; thresholds read from `pack.matching`. |
| `captureHost.ts` | `Frame`, `CaptureStream`, `CaptureHost` port types. |
| `displayMediaHost.ts` | Production host: `getDisplayMedia()` into a detached video and canvas. |
| `sampler.ts` | Bounded-rate loop (default 2 Hz) through an injected `Scheduler`; frame never leaves the tick. |
| `fixtures/` | Test-only PNG loaders, the synthetic pack, and the fake host, scheduler, and clock. Imports Node and pngjs; never imported by production code. |

### Why these observation points are public

The build prompt requires tests to import only the two index modules, the
shared contracts, and the fixtures. `hammingDistance`, `isFingerprint`, and
`DEFAULT_MATCH_OPTIONS` are exported so a test can assert the tuned values and
the README cannot drift from the code; `createSampler` and `Scheduler` are
exported because the instructor module consumes them and the fakes implement
them; `assertPackFingerprints` is exported so the controller can fail loudly
on a pack that skipped the CLI.

## Letterbox handling

Presentation viewers centre the 16:9 slide inside the shared frame and pad
the rest with bars: Google Slides present mode in a tab, Chrome's PDF
viewer, a windowed Keynote. The dhash12 grid covers the whole frame, so the
bars shift every block boundary. Measured on the HNSW pack, a 4:3 tab
pushed slide-02 to distance 22 with a margin of 8 (ambiguous) and a square
viewport matched slide-04 to the wrong slide. `cropToAspect` in
`letterbox.ts` takes the centred 16:9 region before fingerprinting. It is
pure geometry, never content-based, so a slide with a uniform edge is cropped
identically to any other and the pack fingerprints stay valid. With the crop
the same frames are within 4 bits of the pack fingerprint
(`letterbox.test.ts`).
