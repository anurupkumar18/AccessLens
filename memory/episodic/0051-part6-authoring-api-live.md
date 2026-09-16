# 0051 — Part 6: the authoring API is live and proven end to end

Date: 2026-09-16. Branch `workstream/6-authoring`.

## Goal

Execute `docs/prompts/viz-system-build.md` to an API-only product with a
vast test suite and model-behaviour evals proving the LLM produces the
specified resources.

## Owner

Jacob (lead; Claude Fable 5.1 as control plane over Pi async-subagent lanes).

## Changed files

`infra/` (CDK stack `AccessLensAuthoring`, `lib/pipeline-extension.ts`),
`services/` (ingest container, pack-author, audio, publish workflow and
routes, agents, harness, retriever, api), `apps/viewer/`, `scripts/catalog/`,
`packages/catalog/`, `tests/evals/`, `docs/prompts/viz/`,
`apps/extension/src/shared/remotePack.ts` and `packMedia.ts` (D7),
`docs/DEPLOY.md`, `docs/VIZ_DECISIONS.md` (D1–D10), `docs/VIZ_HANDOFF.md`,
`docs/CONTEXT_RELAY.md` (RL-036, RL-037, T-31..T-38, Part 6 row), `vite.config.ts`.

## Validation evidence

- Job 7, execution `9ec32fb5-918f-49f0-ad9f-30b7db5eff85`: upload to
  `review` in 42 s; reviewed and published through the HTTP API; execution
  `SUCCEEDED` at 77 s.
- Pack `https://d7dxgg82mglf.cloudfront.net/packs/hnsw-explainer/2.json`:
  8 assets, 27 regions, 27 audio files, every media and audio HEAD 200.
- `apps/extension/src/shell/App.published.test.tsx` run live against that
  URL: 3 passed (valid pack, student renderers, pipeline-only fields).
- Bedrock evals: pack author 8/8 tuned, 7/7 held-out; planner `none` on
  title slides, `retrieve` elsewhere.
- `make check` green at commit time.

Jobs 1 to 6 each died on something unit tests could not see (ESM bundle in a
CommonJS runtime, JSONPath on an absent field, three Lambdas without a
default AWS client, slides never written onto the job record, two publishers
racing on one seam). The rule that every deploy ends with a real invocation
is what found them.

## Blocker

None for the API spine. The visualization branch is held back on D6 (the
catalog is one template stamped 150 times) and an unbuilt harness image.

## Next action

User decisions D5 and D6 (`docs/VIZ_DECISIONS.md`). D9 was decided and
applied: master is merged, one CDK app carries both stacks, and Part 6's
relay ids are RL-036/037 and T-31..T-38. PR #12 (docs-only) must renumber
its T-31..T-33 and episodic 0052 stays free for it.
