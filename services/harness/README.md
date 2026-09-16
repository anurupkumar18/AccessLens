# Visualization render harness

`services/harness/` is the Lambda-side adapter for the render check required by
`docs/VISUALIZATION_SYSTEM.md` §6 and §8. It stages
`artifacts/{artifactId}/{artifactVersion}/` from the private artifacts bucket,
validates `manifest.json`, runs the viewer's `?mode=harness` page through the
same `RenderCheck` function shape consumed by `services/agents/critic.ts`, and
writes a successful screenshot to:

```text
artifacts/{artifactId}/{artifactVersion}/screenshots/{jobId}.png
```

No artifact is executed in the Lambda process or in an extension page. The
container starts headless Chromium, and the viewer owns the opaque-origin
sandbox where `index.html` runs. `handleHarness` accepts `render` as an
injected dependency so the critic and deployed harness cannot silently grow
separate contracts; the orchestration owner supplies the viewer implementation
when that lane lands.

## Exports

- `handleHarness(event, options)` — testable S3 staging and screenshot handler.
- `handler(event)` — Lambda entry point, using `chromiumRenderCheck()` and
  `ARTIFACTS_BUCKET`.
- `browser.ts` — `RenderCheck`, `createArtifactServer`, and the bounded
  Chromium CLI launcher seam. A deployment may inject a CDP-backed launcher
  without changing the critic contract.

The event is `{ artifactId, artifactVersion, parameters?, jobId }`. When
`parameters` is absent, the manifest's `defaultParameters` are used. The result
contains `ok`, `consoleErrors`, `unhandledRejections`, optional
`screenshotPath`, and the uploaded `screenshotKey`. A manifest or entry-point
failure stops before Chromium is launched. A failed render returns diagnostics
and does not upload a screenshot.

## Image and cold start

The Dockerfile uses the Node 22 Lambda base plus the Amazon Linux `chromium`
package, fonts, and the Node AWS S3 client bundled with esbuild. The expected
compressed image is approximately **0.8–1.2 GB** (package repository and base
updates can move the exact value); the expected headless-Chromium cold start is
**roughly 3–6 seconds**, as called out in spec §16, plus S3 download time.
These are estimates until the image is built and measured in the deployment
account. No Chromium build attempt was run in this environment because no
Chromium executable is installed locally; the launcher is bounded by a 30-second
default timeout and reports a failed render on a non-zero exit.

The image has no idle service: it is invoked by the authoring workflow and all
resources are temporary. The CDK owner must apply `RemovalPolicy.DESTROY` to
any Lambda/ECR resources it adds.
