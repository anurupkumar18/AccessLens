# AccessLens visualization catalog

This catalog contains 30 original, dependency-free CC0-1.0 interactive artifacts in the S3 layout `artifacts/{artifactId}/{artifactVersion}/`. They cover 27 subjects, including graph search, anatomy, timelines, mathematics, chemistry, physics, economics, sorting, maps, statistics, and circuits. Each artifact has a manifest, a keyboard route, an equivalent accessibility description, an `aria-live` state readout, and `accesslensInit`/`accesslensHighlight` hooks.

The seed corpus is intentionally authored in this repository rather than wrapped from an external site. This avoids guessing at a license and is the recorded sourcing deviation for V7. `scripts/catalog/seed.py` is the reproducible generator for these small originals.

## Validate and embed

```sh
npx tsx scripts/catalog/validate.ts
npx tsx scripts/catalog/harness.ts
npx tsx scripts/catalog/embed.ts --harness-report /path/to/report.json
```

`embed.ts` refuses to write vectors unless the viewer harness report covers every artifact and every report is passing. While the viewer harness is unavailable in a checkout, an explicit, visible development-only alternative is:

```sh
npx tsx scripts/catalog/embed.ts --skip-harness
```

That writes `skipHarness: true` into `vectors.json`; it must be regenerated with a passing report before catalog vectors are published. Embeddings use Titan v2 with 256 dimensions and text in the order `title + summary + tags + subjects`. The Retriever performs a brute-force cosine scan in memory, which is faster and simpler than a search cluster for this corpus size.

## Upload

```sh
CATALOG_BUCKET=your-bucket npx tsx scripts/catalog/upload.ts
# or
npx tsx scripts/catalog/upload.ts --bucket your-bucket
```

The bucket is never hardcoded. Upload syncs every file below `packages/catalog/` using its relative key.
