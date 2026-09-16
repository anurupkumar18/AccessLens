# Visualization agents and stage seams

These modules implement spec §8 stages 5–8 from
`docs/VISUALIZATION_SYSTEM.md`. They are plain dependency-injected functions;
the workflow/API owner wires them into Step Functions and job-record updates.
No module here owns orchestration storage, publication, or the extension.

## Wiring map

| Spec stage | Function | Inputs | Dependencies | Output/failure behavior |
| --- | --- | --- | --- | --- |
| 5 — Viz Planner | `planVisualization` (or `planVisualizationResult`) | slide text and PNG, `lesson`, reviewed regions, optional instructor hint, up to 6 excerpts, job/slide IDs | `MessagesClient` and optional prompt directory; `runAgentStage` loads `docs/prompts/viz/viz-planner.md` | `VizPlanSchema`; claims are verified with `verifyReferences`. Any model/schema failure returns `decision: "none"`. |
| 6 — Retriever/route | `routeVisualization` | planner plan, job/slide IDs, optional instructor parameters | injected `retrieveCatalog(concept, 5)` | `none`, `retrieve`, `adapt`, or `generate`. Non-`none` plans retrieve first; an empty/weak result (`score < 0.65`) selects `generate`. A strong parent is exposed for retrieve/adapt. |
| 7a — Adapter | `adaptArtifact` | selected parent manifest/source, plan, job/slide IDs, up to 6 excerpts, optional repair problems | `MessagesClient`; prompt loaded from `docs/prompts/viz/adapter.md` | Complete `{ manifest.json, index.html, assets }` envelope with adapted provenance. Parent id/version/license/job and parameter/default agreement are checked; rejection throws so the caller falls through to generator. |
| 7b — Generator | `generateArtifact` | plan, job/slide IDs, up to 6 excerpts, optional repair problems | `MessagesClient`; prompt loaded from `docs/prompts/viz/generator.md` | Complete generated artifact envelope with generated job provenance. Schema/provenance failures throw; caller marks `no-visual` after its allowed fallback/repair budget. Generator never renders an artifact itself. |
| 8 — Critic | `critique` and `runCritiqueLoop` | plan, artifact envelope and staged directory, optional slide/lesson context, excerpts | required injected `RenderCheck`; optional `MessagesClient`; prompt loaded from `docs/prompts/viz/critic.md` | Deterministic manifest/property checks, then render, then Sonnet fidelity critique. Two repair attempts are allowed; every candidate returns to the same gate. Exhaustion returns `status: "no-visual"`. |

`assertArtifactReady` is the hard-rule-5 proof seam: only a `ready` result with a
clean render and screenshot can be handed to review/publish. The route/API
owner should call it before adding a visualization to a draft or published
pack. A `retrieve` catalog item must be materialized to a staged directory and
run through `runCritiqueLoop` just like adapted/generated output; there is no
retrieved-artifact bypass.

## Shared contracts and constraints

- Agent calls use only `services/shared/agentStage.ts`; do not add a second
  Bedrock client or retry loop.
- `ArtifactDirectorySchema` is the agent boundary: it requires a manifest and
  `indexHtml`, with optional relative asset payloads and claimed references.
- `checkArtifactManifest` and `checkArtifactHtml` from `tests/evals/properties.ts`
  are reused by the critic rather than duplicated.
- All reference claims are checked against the excerpts actually supplied.
- Generated/adapted HTML is untrusted and must execute only through the viewer's
  opaque-origin sandbox. Nothing in these modules evaluates artifact code.
- `services/harness/` owns the Lambda S3/Chromium adapter and uses the same
  injected `RenderCheck` shape.

## Per-slide orchestration sketch

```ts
const planned = await planVisualization({ ... }, { client, promptDirectory });
const routed = await routeVisualization({ plan: planned, jobId, slideId }, { retrieveCatalog });
if (routed.decision === 'none') return { status: 'no-visual' };

let candidate = routed.decision === 'adapt'
  ? await adaptArtifact({ parent: routed.parent!, plan: planned, ... }, { client })
  : routed.decision === 'retrieve'
    ? materializeCatalogParent(routed.parent!) // then still critic-gated
    : await generateArtifact({ plan: planned, ... }, { client });

const checked = await runCritiqueLoop({ artifact: candidate.artifact, artifactDir, plan: planned, ... }, {
  render, client, repair: ({ artifact, problems, attempt }) => repairCandidate({ artifact, problems, attempt }),
});
if (checked.status === 'ready') assertArtifactReady(checked);
// ready -> draft review payload with checked.critique + checked.screenshotPath;
// no-visual -> clean absence; never expose an unrendered artifact.
```

The snippet is wiring guidance, not an alternate pipeline implementation. Job
state should be updated after each stage by the Step Functions owner.
