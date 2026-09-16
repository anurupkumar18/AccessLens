# Deterministic ingest

This container Lambda implements stage 1 from `docs/VISUALIZATION_SYSTEM.md` §8:
LibreOffice converts PPTX to PDF, Poppler renders each page at 1920 pixels wide,
`pdftotext -layout` extracts one text file per page, and the shared screen-source
`fingerprintFrame` writes `dhash12` fingerprints. There is no model or network
call in `ingestDeck`; `DeckSchema` validates its result before it is returned.
DOCX conversion is exported as `convertOfficeToPdf` for the library-indexing lane,
but DOCX is not accepted as a slide deck because `DeckSchema.sourceFormat` is
intentionally `pdf | pptx`.

The Lambda reads `DECKS_BUCKET` and writes only to
`staging/{jobId}/media/{assetId}.png` and `staging/{jobId}/deck.json` in
`PACKS_BUCKET`. The publish stage is responsible for copying approved assets into
published prefixes. `extractedText` is present only in the staged job-internal
`deck.json`, never in a PNG or a pack asset.

## Local checks

```sh
npx vitest run services/ingest
npx tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution Bundler --esModuleInterop --skipLibCheck --ignoreConfig \
  services/ingest/src/ingest.ts services/ingest/src/handler.ts
```

The slow tests run the checked-in HNSW PDF and the generated PPTX against the
same commands used by `scripts/build-pack.ts`. They assert fingerprints, PNG
bytes/dimensions, extracted text, command argv, and the staging-only S3 boundary.

## Fixtures

`apps/viewer/fixtures/decks/generated-mixed-subject.pptx` and
`mixed-subject.pdf` contain eight plain-text slides spanning sorting, chemistry,
economics, biology, history, circuits, statistics, and geography. Regenerate
them after changing the source with:

```sh
python3 apps/viewer/fixtures/decks/generate-fixtures.py
```

The script writes `mixed-subject.fodp`, then asks LibreOffice to convert that
source separately to PPTX and PDF. It uses no network or model output.

## Container sizing and cold start

The image includes LibreOffice and Poppler, so it is expected to be roughly
**1 GB compressed (about 2–3 GB uncompressed)** depending on the Amazon Linux
base and RPM dependency set. The expected authoring-time cold start is roughly
**10–20 seconds**, consistent with the visualization spec §16; the Lambda should
have enough memory and timeout for Office startup and a multi-page deck. The
Dockerfile pins the LibreOffice bundle version and npm/esbuild version; the
Lambda base tag follows AWS's Node.js 22 runtime because AWS publishes its
immutable digest separately for each architecture. If the RPM bundle cannot be
made compatible with the Lambda base, the documented fallback is PDF-only ingest
for the first demo and a separate decision on PPTX support, not a change to the
portable deterministic module.
