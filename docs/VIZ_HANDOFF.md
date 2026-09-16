# Part 6 handoff — the authoring API, as it stands on 2026-09-16

This is the pick-up note for whoever touches the authoring pipeline next.
The build prompt is `docs/prompts/viz-system-build.md`; the spec is
`docs/VISUALIZATION_SYSTEM.md`; every decision the user made or still owes
is in `docs/VIZ_DECISIONS.md`; the deploy and smoke runbook is
`docs/DEPLOY.md`.

## What works, proven live

Stack `AccessLensAuthoring` in account `087328706621`, `us-east-1`. One
`POST /v1/uploads` + `PUT` of a PDF or PPTX, one `POST /v1/jobs`, and the
Step Functions workflow runs ingest (LibreOffice + Poppler container), the
deck analyst, then per slide the pack author and Polly audio, and parks the
job at `review`. `GET /v1/jobs/{id}/draft` returns the draft;
`POST /v1/jobs/{id}/review` records decisions; `POST /v1/jobs/{id}/publish`
writes `packs/<packId>/<n>.json` plus `media/` and returns the CloudFront
URL. The extension loads such a pack with `?pack=<url>` (D7).

Evidence: execution `9ec32fb5-918f-49f0-ad9f-30b7db5eff85` (`SUCCEEDED`,
77 s), pack `https://d7dxgg82mglf.cloudfront.net/packs/hnsw-explainer/2.json`,
and the live test `apps/extension/src/shell/App.published.test.tsx` run with
`ACCESSLENS_PACK_URL` set to that URL (3 passed).

## What is built but not deployed

The visualization branch (`services/agents/`: planner, route, adapter,
generator, critic; `services/harness/`: the render harness) is implemented,
unit-tested, and evaluated against live Bedrock (`tests/evals/`). The
workflow (`services/publish/workflow.ts`) takes its full shape as soon as
`PipelineExtensionPoints` passes the six visualization ARNs. It does not,
because:

- the catalog those stages retrieve from is one template stamped 150 times
  and the harness cannot tell (D6, decision needed);
- the harness Lambda's Chromium image is not built;
- `recordVisualization` has no Lambda handler yet.

Until then every slide reports `visualizationStatus: "no-visual"`, which the
spec designs as the clean absence.

## Ownership and invariants that must survive

- Only the publish route writes `packs/`, `media/`, `artifacts/`, and only
  after `publishPack` has checked each asset's review decision (hard rule 2,
  D10). The workflow observes `published`; it never publishes.
- Only Sonnet 4.6 and Titan embed v2, only from Lambda (hard rule 12). The
  catalog vectors are the one deviation, computed by a local script (D5).
- No student identifier, preference or connection record touches AWS
  (charter A4). The pipeline stores instructor jobs only.
- Every Lambda builds its AWS clients at its handler boundary; tests inject
  `readObject` / `writeObject` / `putObject` / `loadJob` and never touch AWS.
  Three real jobs died to the missing-default-client bug; keep the pattern.
- `RemovalPolicy.DESTROY` everywhere; `make destroy` removes the stack.

## Operating it

```sh
make deploy          # builds the viewer, deploys, writes .cdk-outputs.json
make smoke           # health, sandbox, one real job to review
scratchpad scripts:  real-job.sh, review-publish.sh <jobId>   (session-local)
make destroy
```

Costs: a job is cents of Bedrock and Polly; the stack idles at zero except
CloudFront and the DynamoDB table, both pay-per-request.

## Open with the user

- D5 — catalog embeddings built locally rather than in Lambda.
- D6 — the catalog needs real seeds and a substance gate before the
  visualization branch is worth deploying.
- D9 — `origin/master` carries Part 4's own `infra/` CDK app and the UI
  rebuild; merging needs one CDK app with two stacks and a relay renumber.
