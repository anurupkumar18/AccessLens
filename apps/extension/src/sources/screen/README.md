# Screen source: fingerprint contract and matcher

This directory is Part 2's screen source (implementation-plan A3 explicit
capture and A4 mock slide matcher). It is the only code that touches raw
frames, and a frame lives for exactly one `sampleFrame()` to fingerprint pass.
Everything downstream (controller, panel, events) holds strings and IDs only.

## The `fingerprint` field

`AccessPack.assets[].fingerprint` is a **difference hash, version 1**:

```text
dhash-v1:<sixteen lowercase hexadecimal characters>
```

Example (`slide-01` in the synthetic pack): `dhash-v1:3f8f4f4747474fcf`. `isFingerprint()` in `fingerprint.ts`
is the format check; `assertPackFingerprints()` rejects a pack whose assets
carry anything else, so a pack that skipped the CLI fails at controller
construction rather than silently never matching.

### Algorithm (exact)

1. **Luminance.** Convert each RGBA pixel to luminance with Rec. 601 weights
   on 8-bit values: `0.299 R + 0.587 G + 0.114 B`. Alpha is ignored.
2. **Grid.** Downsample to a 9-wide by 8-high grid by area averaging over the
   full frame. Cell `(row, col)` covers pixel columns
   `floor(col * width / 9)` to `floor((col + 1) * width / 9) - 1` and rows
   `floor(row * height / 8)` to `floor((row + 1) * height / 8) - 1`; its value
   is the arithmetic mean of the luminance of every pixel inside. No cropping,
   no letterbox detection. Aspect ratio does not matter because the grid is
   defined in fractions of the frame.
3. **Bits.** For each of the 8 rows, for each of the 8 adjacent column pairs
   left to right, emit `1` when the left cell's mean is strictly greater than
   the right cell's, else `0`. That is 64 bits.
4. **Pack.** Row-major, most significant bit first, into 16 hex digits.

Comparison is Hamming distance (number of differing bits, 0 to 64).

### Matching rule

`matchFingerprint(fingerprint, pack, { threshold, margin })`:

- Compute the distance from the frame to every asset.
- The frame **matches** the nearest asset only when its distance is at or
  below `threshold` **and** every other asset is at least `margin` bits
  farther away.
- Otherwise the frame is **unmatched** (`reason: 'no-candidate'` when nothing
  is close enough, `'ambiguous'` when two assets are too close to each other).

A marginal match is an unmatched match. The controller turns three
consecutive unmatched samples into one `source.unmatched` event; a single
transition frame never flashes students to Unmatched.

### Threshold and margin: 10 and 4

`DEFAULT_MATCH_OPTIONS = { threshold: 10, margin: 4 }`. These are the values
the build prompt started from and the fixture evidence did not require moving
them. The distance table below was produced by
`fingerprintFrame` over the checked-in fixtures (clean 1920x1080 renders in
`fixtures/slides/`, demo-condition variants in `fixtures/slides/demo/`).

Pairwise distance between clean fixtures:

| | 01 | 02 | 03 | 04 | 05 | 06 | twin-a | twin-b | unknown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| slide-01 | 0 | 38 | 27 | 28 | 30 | 33 | 36 | 36 | 28 |
| slide-02 | 38 | 0 | 15 | 24 | 16 | 21 | 18 | 18 | 22 |
| slide-03 | 27 | 15 | 0 | 31 | 17 | 18 | 17 | 17 | 23 |
| slide-04 | 28 | 24 | 31 | 0 | 30 | 19 | 32 | 32 | 22 |
| slide-05 | 30 | 16 | 17 | 30 | 0 | 27 | 18 | 18 | 18 |
| slide-06 | 33 | 21 | 18 | 19 | 27 | 0 | 19 | 19 | 15 |
| twin-a | 36 | 18 | 17 | 32 | 18 | 19 | 0 | 0 | 32 |
| twin-b | 36 | 18 | 17 | 32 | 18 | 19 | 0 | 0 | 32 |
| unknown-01 | 28 | 22 | 23 | 22 | 18 | 15 | 32 | 32 | 0 |

Demo-condition variant (1280x720 rescale, +10 brightness, 4 px bezel,
block-shaped compression noise) against every pack asset:

| demo frame | own asset | nearest other | decision |
| --- | --- | --- | --- |
| slide-01 | 5 | slide-04 27 | matched, distance 5 |
| slide-02 | 2 | slide-03 13 | matched, distance 2 |
| slide-03 | 4 | slide-05 15 | matched, distance 4 |
| slide-04 | 3 | slide-06 20 | matched, distance 3 |
| slide-05 | 1 | slide-02 17 | matched, distance 1 |
| slide-06 | 4 | slide-04 17 | matched, distance 4 |
| solid black or white | 39 (slide-01) | 41 | unmatched, no-candidate |
| unknown-01 (clean) | 15 (slide-06) | 18 | unmatched, no-candidate |
| twin-a / twin-b (clean) | 0 | 0 | unmatched, ambiguous |

Reading the table: the largest self-distance under demo conditions is 5 and
the smallest cross-distance from any demo frame is 13, so a threshold of 10
leaves 5 bits of headroom on one side and 3 on the other; a margin of 4 is
cleared by at least 11 bits on every approved frame. The twins differ by 0
bits, so the ambiguity rule is what rejects them, and it does so with the
threshold alone unable to help. The first fixture set had cross-distances of
7 to 11 bits; that was fixed by redesigning the fixture layouts (see the
comment block in `scripts/generate-slide-fixtures.ts`), not by moving the
threshold.

To reproduce the table run
`npx tsx` on a script that imports `fingerprintFrame`/`hammingDistance` from
this directory and the loaders from `fixtures/`, or simply run
`npx vitest run apps/extension/src/sources/screen`, whose tests assert every
row's decision.

### Known limitation for Part 5 (real slides)

A difference hash compares neighbouring cells, so a **large flat region**
(a plain white slide background) yields ties that the strict `>` resolves to
`0` in the clean render but that compression noise can flip either way in a
shared window. Slides whose 9x8 cells are mostly flat background may show
self-distances well above 5 under real screen sharing. When Part 5 produces
the reviewed pack:

1. Fingerprint the clean exported slide PNGs with the CLI below.
2. Share the deck through Chrome, sample a few frames per slide, and record
   the distance table as above.
3. If a real slide's self-distance approaches 10, prefer changing the slide
   (add a visible footer, a page number block, a coloured band) or the export
   over raising the threshold; if the threshold must move, record the table
   that justified it here.

The synthetic fixtures use a light-to-mid background wash so that flat areas
have a deterministic left-brighter-than-right ordering; the generator comment
explains how the six layouts were chosen as (8,4) extended-Hamming codewords
over a 4x2 macro grid so any two differ in at least four macro cells.

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

## Module map

| File | Role |
| --- | --- |
| `index.ts` | Public surface. Tests and the instructor module import only from here. |
| `fingerprint.ts` | Pure: `Frame` to `dhash-v1` string; Hamming distance; format check. |
| `matcher.ts` | Pure: fingerprint to `MatchDecision` with threshold and margin. |
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
