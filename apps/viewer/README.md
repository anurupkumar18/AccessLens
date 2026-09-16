# AccessLens viewer (V1)

The viewer is a static React/Vite app. The top-level host page owns the
`viz.*` message protocol; reviewed artifact HTML runs only in the iframe loaded
from `sandbox.html` with `sandbox="allow-scripts"` and without
`allow-same-origin`. No artifact code is evaluated by the host page or by the
extension.

## Build and run

From the repository root:

```sh
npx vite build --config apps/viewer/vite.config.ts
npx vitest run apps/viewer
npx tsc --noEmit
```

The build writes `apps/viewer/dist/` with relative paths and includes
`index.html`, `sandbox.html`, the bundled assets, and the checked-in fixture
artifacts under `artifacts/`. Set `VITE_ACCESSLENS_ARTIFACT_BASE` to the static
viewer/artifact origin when artifacts are hosted separately. Set
`VITE_ACCESSLENS_ALLOWED_ORIGINS` to a comma-separated list of trusted parent
origins; `chrome-extension://*` matches any Chrome extension origin.

The local render harness is:

```sh
npx tsx apps/viewer/harness/run.ts \
  --artifact-dir apps/viewer/fixtures/artifacts/hnsw-search-stepper/1 \
  --screenshot /tmp/accesslens-hnsw.svg
```

V1 uses the jsdom driver because this environment has no Playwright, Puppeteer,
or Chrome binary. It proves manifest validation, script execution,
`accesslensInit`, keyboard/lifecycle behavior, console errors, and unhandled
rejections. Its SVG is a deterministic DOM snapshot, not a browser pixel
screenshot; CSS layout, compositor pixels, and real opaque-origin enforcement
require the future Chromium implementation behind the same
`harness/browser.ts` interface.

## Sandbox CSP

`sandbox.html` carries this exact meta policy:

```text
default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'
```

The CDN must send the policy as a response header as well (with the same
semicolon-separated value):

```http
Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'
```

The viewer response (not the artifact) should also set the deployment-specific
`frame-ancestors` policy described in `docs/VISUALIZATION_SYSTEM.md` §6. Do not
weaken `connect-src 'none'`, add `allow-same-origin`, or use a wildcard
`postMessage` target.

## Blessed libraries

`src/blessed/registry.ts` is the one viewer-origin registry. It contains exactly
the names in `BLESSED_LIBRARIES` and loads lazily. `three@0.186` is live because
`three` is already installed. The other six names intentionally use marked
`blessed-library-not-bundled` loaders in V1:

- `d3@7`
- `cytoscape@3`
- `plotly-basic@2`
- `animejs@3`
- `katex@0.16`
- `chartjs@4`

To make one live, install its pinned major-version dependency at the repository
root and replace its registry entry with an import, for example:

```sh
npm install d3@7
```

Then change the `d3@7` loader from `notBundled('d3@7')` to a lazy import of the
installed module. The equivalent one-line installs are `npm install
cytoscape@3`, `npm install plotly.js-basic@2` (and expose the basic bundle),
`npm install animejs@3`, `npm install katex@0.16`, and
`npm install chart.js@4`. No artifact may load a remote library URL; a manifest
naming anything outside the blessed enum fails in the host with `viz.error`
code `manifest` before the sandbox receives a render command.
