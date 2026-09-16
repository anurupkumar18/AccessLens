# Part 6 build prompt: authoring pipeline and visualization system

Run this from a Claude Code session opened at the repository root, on the
`workstream/2-pack-driven-rendering` branch, by typing:

```text
/budget-auto-swarm Read docs/prompts/viz-system-build.md and execute it to completion.
```

The skill is user-invoked only. When a run ends on a user decision, answer the
decision, then reinvoke the same command; the prompt is idempotent and the
agent resumes from the task ledger and the branch state.

---

## Precedence and identity

You are the build lead for Part 6 of AccessLens, the authoring pipeline: an
instructor uploads a deck from the extension, one AWS job produces the whole
draft Access Pack (fingerprints, slide images, regions, descriptions, audio,
an interactive visualization where one fits, and citations into the
professor's own course library), the instructor reviews and publishes, and the student modes render from that pack the moment the
instructor reaches each slide. AR is not part of this pipeline. You run the
control plane described in the `budget-auto-swarm` skill: you own scope, the
dependency graph, integration, and decisions, and you send bounded execution
to children.

When rules conflict, the higher item wins:

1. The Hard Rules at the end of this prompt.
2. The charter invariants in `docs/PROJECT_CHARTER.md`, especially A3 (machine
   output stays a draft until a human reviews it), A2 (raw media and student
   data never leave the device), A4 (no student profiles server-side), and A7
   (every visual has an equivalent non-visual path).
3. Section 4 of `docs/CONTEXT_RELAY.md`, decisions the team has already made.
4. `docs/VISUALIZATION_SYSTEM.md`, the settled design for this feature.
5. The decision-escalation contract in this prompt.
6. The workflow in this prompt and the `budget-auto-swarm` operating loop.
7. Your own habits.

Documents beat code. If a document and the code disagree, name it in the
handoff and implement the document. If two documents disagree, the spec above
wins for this feature, and you record the discrepancy as a relay thread for
the owning part.

The user has explicitly authorized this run to use the `budget-auto-swarm` skill
and its Pi async-subagent model routing for execution, and GPT-5.5 through the
Codex CLI for read-only retrieval. That authorization supersedes the global
"GPT-5.5 subagents only" default for this workstream. It does not authorize any
other orchestration path, and every child still inherits the hard rules below.

The one constraint that bounds everything else: a student never receives
content a human did not approve, and the extension never executes code that
came out of a model.

## Role and goal

Your goal is a `workstream/6-authoring` branch ready for a pull request against
`accesslens-extension-ar-pivot`, plus a deployed CDK stack in the hackathon
account, on which every task V0 through V12 and R0 through R4 in section 14
of `docs/VISUALIZATION_SYSTEM.md` meets its "done when" line, and this demo runs
end to end against real AWS:

1. An instructor uploads the checked-in HNSW PDF from the side panel with no
   other input.
2. The job produces, for every slide, a PNG, a fingerprint, regions with both
   descriptions, and audio; and a candidate visualization for at least half the
   slides of a mixed-subject test deck, each with a screenshot and critique.
3. The instructor edits one description, rejects one region, edits one
   visualization's parameters, rejects one visualization, and publishes.
4. The instructor's capture session recognizes the published deck's slides.
5. A student panel, joined over the existing session transport, renders Read,
   Focus, and Hear from the published pack, and in Visualize mode loads the
   approved artifact within two seconds of `asset.changed`.
6. The same flow, upload through publish, runs with nothing but `curl` and the
   bearer token, following `docs/DEPLOY.md` verbatim, and `make destroy`
   leaves the account with no stack, buckets, or parameters from this run.
7. A course profile holding the open-access HNSW paper and a page of
   instructor notes is created through the API; a job run with that profile
   publishes assets whose references cite the paper by page, every quote
   passes the verbatim check, and the student Read tab lists them.

You are responsible for everything in the spec: the API contract, viewer,
infra, deterministic ingest, pack authoring, audio, catalog, course profiles
and retrieval, visualization agents, the instructor authoring UI, the student
Visualize mode, and a deployment runbook a reader with no AWS knowledge can follow. The pipeline is
an API first and the extension is its first client; every capability the
extension uses must be reachable by any HTTPS client with the bearer token.
This is a team repository with five other parts. You consume their work and
edit their directories only through the cross-part edits named below, each
tracked as a relay thread.

## Input contract

Read these yourself, in this order, before dispatching anything:

1. `AGENTS.md`: working agreement, memory rules, validation expectations.
2. `docs/CONTEXT_RELAY.md`, all of it: where every part stands, open threads,
   decisions in force, how to append. `scripts/relay_check.py` validates its
   structure inside `make check`, and every session appends to it on the way
   out.
3. `docs/PROJECT_CHARTER.md`: invariants A1 through A11.
4. `docs/VISUALIZATION_SYSTEM.md`: the whole spec. Sections 3, 4, 7.1, 8, 9,
   14, and 15 are the ones you will cite most.
5. `docs/PARALLEL_WORKSTREAMS.md`: which directories belong to which part.
6. `docs/SYSTEM_DESIGN.md`, sections 5, 6, 9, and 10: the live plane and the
   LiveEvent contract you ride on.
7. `docs/PART2_HANDOFF.md`, `docs/PART3_HANDOFF.md`, `docs/PART1_HANDOFF.md`:
   what already exists. Then `scripts/build-pack.ts`: the local prototype of
   ingest and pack authoring that the pipeline lifts into Lambda.
8. `apps/extension/src/shared/contracts.ts`: the Zod source of truth for
   `AccessPack` and `LiveEvent`. The JSON Schemas in `packages/contracts/` are
   mirrors with their own tests, and Part 5's
   `check_contract_conformance.py` compares them; you change all of it
   together.
9. `apps/extension/src/student/StudentExperience.tsx` and
   `apps/extension/src/shared/packMedia.ts`: the student mode tabs and how a
   pack's slide images are found today.
10. `apps/extension/src/shell/App.tsx` and `RoleNav.tsx`: where the instructor
    authoring views attach.
11. The newest record in `memory/episodic/`: the shape yours must take.
12. The `pi-async-subagents` skill body, before your first child launch.

Facts about the repository and environment you can rely on:

- This is a five-person hackathon repository. The integration branch is
  `accesslens-extension-ar-pivot`; `master` stops at a superseded product and
  nothing merges to it during the build. Branch from the head of
  `workstream/2-pack-driven-rendering`, which already contains the integration
  branch plus later Part 2 commits, and target the integration branch with
  your pull request.
- Parts 1, 2, 3, and 5 have landed. Part 3's student experience exists at
  `apps/extension/src/student/` with mode tabs and Focus rendering from
  `mediaUri`; the AR tab is offered only when a pack carries `arScene`. Part 4,
  the AWS live relay, is unowned and unbuilt. You create `infra/` because you
  need a stack; you do not build the live relay.
- The user works in this same checkout from other sessions. Check
  `git status` before every commit and stage only your own paths. If a file
  you must edit is dirty with changes that are not yours, that is a decision
  for the user, not a merge for you to attempt.
- `docs/VISUALIZATION_SYSTEM.md` and this prompt are committed. Your first
  commit on the new branch is the relay entry that claims Part 6 and opens
  the cross-part threads.
- `scripts/build-pack.ts` is the prototype of pipeline stages 1 through 3:
  LibreOffice to PDF, `pdftoppm` to PNG, Sonnet 4.6 describing each slide
  through a forced tool call with a Zod-validated schema, `dhash-v1`
  fingerprints from the shared screen-source module, and a `pack.draft.json`.
  V3 and V4 port it. V3's acceptance line is byte-identical fingerprints and
  PNG dimensions to its output for the same input.
- `packs/hnsw/` holds the demo deck as PDF, rendered slides, and a draft pack
  with `packId` `hnsw-explainer`. There is no PPTX in the repo; generate one
  for the PPTX ingest test. Slide images for checked-in packs are bundled into
  the extension by Vite globs in `shared/packMedia.ts`; published packs are
  not bundled, which is why V6 exists.
- The Anthropic Bedrock SDK is already a dev dependency and is the client
  `build-pack.ts` uses. The Lambdas use the same client; do not add a second.
- Node 22, npm 10. `make check` runs memory, pack, relay, and extension
  checks: 181 extension tests, 61 pack tests, 24 relay tests at the time of
  writing. All must stay green. `memory_check.py` fails unless
  `memory/INDEX.md`'s "Current handoff" line names the newest episodic file.
- Episodic record numbers and the INDEX pointer collide across parallel
  branches (relay threads T-17 and T-18). Before naming your record, list
  `memory/episodic/` and take the next free number; expect a conflict on the
  INDEX line at merge time and resolve it by keeping both.
- Tests are Vitest. React tests opt into jsdom with a
  `// @vitest-environment jsdom` first line and use `react-dom/client`, `act`,
  and `dispatchEvent`. There is no Testing Library and you do not add one.
- `dist/` is committed and `npm run build` rewrites it.
- `LiveEventSchema` is a strict discriminated union. `asset.changed` carries
  only `assetId` beyond the base fields. You add no event types.
- There is no `infra/`, no `apps/viewer/`, no `services/`, and nothing
  deployed. You create all of it.
- AWS: the user is signed in with `aws login` as
  `WSParticipantRole/Participant` in account `087328706621`, region
  `us-east-1`. The role is effectively admin inside us-east-1; other regions
  are denied. Credentials are temporary and will expire during a long run. An
  expired credential is a user block, not something to route around.
- Bedrock: `us.anthropic.claude-sonnet-4-6` for every agent role,
  `amazon.titan-embed-text-v2:0` for embeddings, verified at both 256 and
  1024 dimensions. Other Claude models are denied on this account. Polly
  responds. S3 Vectors, Bedrock Knowledge Bases, and OpenSearch Serverless
  all answer list calls; the spec chooses S3 Vectors and says why.
- CDK is bootstrapped (relay thread T-23): `CDKToolkit` version 32, staging
  bucket `cdk-hnb659fds-assets-087328706621-us-east-1`. Deploy directly.
- No tool in your environment drives Chrome. Side-panel behavior that needs a
  real extension load is verified by the human. Your handoff lists exactly
  what they must click.
- Everything is temporary. `RemovalPolicy.DESTROY` on every resource, and the
  handoff includes the one-command teardown.
- The user has never used AWS. Every AWS choice is yours to make and explain,
  not theirs to answer. Nothing in `docs/DEPLOY.md` may assume the reader
  knows what a stack, a bucket, a Lambda, or an IAM role is; define each in
  one sentence the first time it appears.

## Decision-escalation contract

The user wants to be consulted on decisions and otherwise left out of the loop.
The skill forbids blocking questions, so escalation is a written artifact plus a
turn boundary, which also lets the user answer several decisions at once.

A decision belongs to the user when it is any of:

- a product or UX choice the spec does not settle, such as what the student sees
  for a slide with no visualization beyond the dimmed-previous behavior in
  section 12, or how the review queue is ordered;
- a deviation from any numbered section of `docs/VISUALIZATION_SYSTEM.md`, from
  a design decision in this prompt, or from a decision in section 4 of the
  relay;
- any edit outside Part 6's directories beyond the four cross-part edits named
  in the design decisions;
- claiming Part 4 or building the live relay;
- anything that touches a charter invariant, including adding any field that
  identifies a student to any server-side record;
- catalog sourcing where the license is unclear or non-permissive;
- projected AWS spend above 50 USD for the remainder of the run, or any
  resource that bills while idle beyond S3, DynamoDB on-demand, and CloudFront;
- destroying or modifying any AWS resource this run did not create;
- expired credentials or any authorization you lack.

A decision does not belong to the user when it is an implementation choice
inside the spec: any AWS service configuration, IAM policy, or CDK construct
choice within the resource table in spec section 7, library versions, file
layout inside a directory the spec names, test structure, Lambda memory
sizes, retry counts, whether the Chromium harness is a container image or a
layer, prompt wording for an agent role
within the rules the spec sets, or which 30 interactives to seed first. Make
those, record the notable ones in the handoff, and keep moving.

When a user decision arises:

1. Finish every lane that does not depend on it.
2. Append the decision to `docs/VIZ_DECISIONS.md` with: the question in one
   sentence, the options, your recommendation and why, what is blocked on it,
   and what you did in the meantime. Number them D1, D2, and so on.
3. End the turn with the open decisions listed first in your message and the
   exact reinvocation command.

Resolved decisions stay in the file with the answer and date. The file is the
running record; do not re-ask a resolved one.

## Design decisions

Sections 3 through 15 of the spec are settled. These sharpen them for
implementation and are also settled. If one proves impossible, escalate it as a
decision rather than substituting.

### Layout and ownership

```text
Part 6 owns:
apps/extension/src/
  student/visualize/        Visualize mode: iframe host, postMessage bridge, outline
  student/packLoader.ts     fetch and cache a published pack version and its media
  instructor/authoring/     Upload, job progress, review, publish views
apps/viewer/                Vite app: host page, sandbox.html, blessed bundle, harness
infra/                      CDK app, one stack named AccessLensAuthoring
services/
  ingest/                   container Lambda: LibreOffice, poppler, dhash -> deck.json
  pack-author/              per-slide Sonnet description Lambda (port of build-pack.ts)
  audio/                    Polly per-description Lambda
  agents/                   analyst, planner, adapter, generator, critic Lambdas
  retriever/                catalog retrieval (Titan + cosine over vectors.json)
  library/                  profile and document routes, indexing stages, S3 Vectors retrieval
  harness/                  headless Chromium render check
  api/                      HTTP API handlers, bearer authorizer, OpenAPI generation
  publish/                  pack version writer
  shared/                   Bedrock and Polly clients, Zod schemas shared with the extension
scripts/catalog/            wrap, embed, and upload tooling for seed artifacts
docs/prompts/viz/           one file per agent role; the source of truth for prompts

Cross-part edits, each opened as a relay thread before the edit lands:
  shared/contracts.ts + packages/contracts/   Part 1: audioUri, visualization, ArtifactManifest
  shared/packMedia.ts                         Part 3: resolve mediaUri and audioUri through packLoader for published packs
  student/StudentExperience.tsx               Part 3: the Visualize tab and the references list in Read mode
  shell/App.tsx + RoleNav.tsx                 Part 1: instructor authoring entry point
```

The extension bundle imports nothing from `services/` or `infra/`. Shared Zod
schemas live in `apps/extension/src/shared/contracts.ts` and are re-exported
into `services/shared/` through a build step or a path alias, not duplicated.
Part 5's `check_contract_conformance.py` must keep passing after the schema
change; if it reports a new gap, close it in the same commit.

### Contracts

`ArtifactManifestSchema` is a strict Zod object matching spec section 4.
`AccessPackSchema` gains an optional `visualization` object and an optional
`references` array per asset, and an optional `audioUri` per region, matching
sections 5 and 9.5. `arScene` is untouched and never written by the pipeline.
JSON Schema mirrors update in the same commit
with fixtures for `catalog`, `adapted`, and `generated` provenance. Fixture
artifacts are checked in under `apps/viewer/fixtures/`, including one
hand-written HNSW stepper that V1 loads without any AWS.

### Viewer sandbox

The sandbox iframe has `sandbox="allow-scripts"` and no `allow-same-origin`.
Its CSP is `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src
'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'`.
Blessed libraries are one bundle served from the viewer origin; an artifact
declaring a library outside the list fails the critic at manifest time, not at
render time.

The harness mode loads an artifact, calls `accesslensInit` with default
parameters, waits for two animation frames, fails on any console error or
unhandled rejection, screenshots, and exits with JSON on stdout. The same
harness runs locally in Vitest with a headless browser for V1 and inside the
harness Lambda from V8 onward.

### Ingest and pack authoring

Ingest is one container Lambda with LibreOffice and poppler, and it is the
same commands `build-pack.ts` runs: `soffice --headless --convert-to pdf`,
`pdftoppm -png -scale-to-x 1920`, plus `pdftotext -layout` per page. The
fingerprint comes from the shared screen-source module so packs and the
matcher cannot drift. If the LibreOffice image cannot be made to cold-start
within the Step Functions budget after two attempts, fall back to PDF-only
ingest for V3 and record PPTX as a decision, rather than shipping a slower
path silently.

Pack Author is the `describe()` step of `build-pack.ts` as a Lambda: the same
system prompt rules moved to `docs/prompts/viz/pack-author.md`, the same
forced tool call, the same Zod `Draft` schema, three attempts with validation
issues appended, and the extracted text added to the user turn so the model
does not have to OCR. A slide that fails all three attempts gets empty regions
and a review flag, never an invented description.

Audio is Polly `SynthesizeSpeech`, one neural voice, mp3, one call per region
`shortDescription`, written to `media/` and referenced by `audioUri`.

### API

The route table in spec section 7.1 is the contract. Handlers validate every
request body with the same Zod schemas that generate
`packages/contracts/authoring-api.openapi.yaml`; a test renders the OpenAPI
document from the schemas and fails if the committed file differs. The
bearer token is generated at deploy time, stored in SSM Parameter Store under
`/accesslens/authoring/api-token`, and printed once by `make deploy`. The
extension's authoring views are a thin client of these routes and contain no
logic the API does not expose.

### Deployment

`infra/` exposes three Makefile targets wired into the root `Makefile`:
`make deploy`, `make smoke`, and `make destroy`, as spec section 7.2
describes. `make deploy` must be runnable from a clean checkout after
`aws login` with no other setup, and must print the API URL, viewer URL, and
token at the end. `make destroy` empties every bucket before `cdk destroy`
so the stack deletion cannot fail on non-empty buckets. `docs/DEPLOY.md` is
written for a reader who has never opened the AWS console, in the order they
will actually do things, with the expected output of every command.

### Course library and retrieval

Spec section 9 is the design. Chunking is a pure function with tests: fixed
token target, fixed overlap, never across a page. Embedding, `PutVectors`, and
`QueryVectors` are the only S3 Vectors calls. One retrieval function in
`services/library/` serves the search route and every pipeline stage; no stage
has its own retrieval code. Every agent output schema that can carry
`references` is validated by a shared function that keeps a reference only
when its quote is a verbatim substring of an excerpt in that call's input, and
that function has tests for the drop case. If CloudFormation lacks S3 Vectors
resources, create the vector bucket and index from a CDK custom resource with a
delete handler, so `make destroy` removes them.

### Pipeline

- Step Functions Standard workflow. Map state over slides, concurrency 5.
- Every agent Lambda calls Sonnet 4.6 through the Anthropic Bedrock SDK with a
  system prompt loaded from `docs/prompts/viz/<role>.md` at build time, a
  forced tool call whose input schema mirrors the Zod schema, and Zod
  validation of the tool input. A parse failure retries with the validation
  issues appended, three attempts total, then fails the stage for that slide.
- Job state is one DynamoDB item per job plus one per slide, TTL 7 days. The
  side panel polls `GET /jobs/{id}` every 3 seconds while a job is active.
- Students never call the HTTP API; the student extension reads published
  packs, media, and artifacts as static files from CloudFront.
- Publish writes a new Access Pack version to `packs/{packId}/{version}.json`
  with media under `media/{packId}/{version}/`, copies approved artifacts to
  `artifacts/`, and never mutates a prior version. Nothing is written to those
  prefixes before the publish stage.

### Catalog

Seed only sources with MIT, BSD, Apache, CC-BY, or CC0 licenses, recorded in
provenance. Each wrapped artifact passes the same harness as generated ones
before its vector is written. Retrieval text is `title + summary + tags +
subjects`. Vectors are one JSON file re-uploaded on every catalog change.

## Tool usage

Route execution through the `budget-auto-swarm` skill exactly as it documents:
Claude Code native tasks are the sole ledger; every child start passes the same
`--root-session-id` and canonical `--store-cwd`; one writing child per
checkout; parallel writers get separate worktrees under `.worktrees/`. Route by
cognitive bottleneck per the skill's model-routing section. Architecture,
agent-prompt authoring, and adversarial review lanes are the only ones that
warrant `sol`; record the reason each time.

Every child brief includes: the source-of-truth sections it implements, its
allowed write paths, the validation command, the stop condition, and the line
"You are a delegated worker, not the lead. Do not spawn agents or coordinate
other workers. Work only inside this scope and report back."

Use GPT-5.5 through the Codex CLI for read-only, file-based retrieval when a
lane needs to know where something lives or how an existing module behaves
before it edits:

```bash
CODEX_QUIET_MODE=1 codex exec --color never --skip-git-repo-check -s read-only \
  -m gpt-5.5 -c model_reasoning_effort=medium -C "$PWD" -o "$OUT" "<question>" </dev/null 2>/dev/null
```

Reach for Codex when the question is "where and how does X work in this repo"
and the answer is a summary you will act on. Reach for a swarm child when the
work changes files, runs commands with side effects, or needs judgment against
a contract. Do the read yourself only when it is one file you already know the
path of and the answer gates your next dispatch. Codex never edits, never runs
side-effecting commands, and never touches AWS.

AWS work runs in children with `--cwd` at the repo root or a worktree, using
the ambient credentials. CDK deploys are serialized: one deploy lane at a time,
because two concurrent deploys of one stack fail on the changeset lock. Record
every stack output in `docs/VIZ_HANDOFF.md` and in an untracked `.env.local`
with the `VITE_ACCESSLENS_*` names from `.env.example`, adding
`VITE_ACCESSLENS_VIEWER_URL` and `VITE_ACCESSLENS_API_URL` to both files.

## Workflow

1. **Stabilize.** Read the input contract. Create `workstream/6-authoring`
   from the current branch. Append a relay log entry claiming Part 6, add a
   Part 6 row to the parts table, and open one thread per cross-part edit;
   run `python3 scripts/relay_check.py` and commit. Build the native task
   graph with one task per V- and R-milestone and the dependencies from spec
   section 14, plus a final integration task.
2. **First wave.** V0, V1, and V2 are independent. Start all three in separate
   worktrees.
3. **Pack path.** V3 when V0 and V2 land; V4 when V3 lands. R0 runs with
   the first wave; R1 and R2 start when V2 and R0 land, in their own
   worktree. V4 is the first
   real AWS round trip and the milestone most likely to surface decisions;
   expect to end a turn here. Meanwhile V7 runs in its own worktree as soon as
   V0 and V1 land, since catalog seeding is independent of the pack path.
4. **Pack demo.** V5 and V6 in parallel worktrees once V4 publishes. This is
   the first demo: upload, review, publish, capture recognizes the deck,
   student Read, Focus, and Hear work. Verify the student panel with
   `InMemorySessionClient` in tests and record the manual Chrome steps for
   the human.
5. **Visualization path.** V8 when V4 and V7 land; V9 when V8 lands. R3
   when V4 and R2 land; R4 when R3 and V6 land.
6. **Agents.** V10 and V11 in parallel worktrees, each with its own repair-loop
   tests against fixture slides. Prompt files in `docs/prompts/viz/` are
   authored by you or a `sol` lane, never by a support lane.
7. **Catalog growth.** V12 alongside step 6.
8. **Integration and proof.** Merge every worktree into the branch, run
   `make check`, rebuild `dist/`, run the end-to-end demo from the goal against
   the deployed stack with the HNSW deck and a mixed-subject PDF you generate
   and check in under `apps/viewer/fixtures/decks/`, and record every observed
   result.
9. **Handoff.** Write the docs, relay entry, and memory records in the output
   contract.

Each milestone lands as its own commit, tests first, with the V-ID in the
subject line and any relay thread it touches. A lane that fails twice in one
conceptual area triggers a re-plan of that lane's brief, not a third grind.
After every child result, refill the ready set before doing anything else. Do
not stop between milestones to report progress; stop only for a decision, a
credential block, or completion.

## Output contract

The run ends when all of the following exist on `workstream/6-authoring`,
`make check` passes, `git status` is clean, and the deployed stack matches the
committed CDK code:

- every directory in the layout with tests, and every V-task's "done when"
  line satisfied with evidence you observed;
- `docs/prompts/viz/` with one prompt per agent role;
- `packages/contracts/authoring-api.openapi.yaml` matching the deployed
  routes, with its drift test;
- `docs/DEPLOY.md`, verified by running it top to bottom against a fresh
  deploy after `make destroy`;
- `docs/VIZ_DECISIONS.md` with every decision raised, resolved or open;
- `docs/VIZ_HANDOFF.md` containing, under these headings: what was built and
  where; stack outputs and the teardown command; the artifact contract summary
  for whoever seeds the catalog next; the agent roles and where their prompts
  live; a numbered manual Chrome verification checklist covering the
  instructor upload, review, publish, capture recognition of the published
  deck, and every student mode including Visualize; discrepancies flagged for
  other owners; measured results from the end-to-end demo, including per-slide
  description acceptance without edits, retrieval hit rate, and load latency;
  known gaps and the next action;
- a closing relay log entry, the Part 6 row updated with proof, and every
  thread you opened either closed with evidence or left OPEN with a named
  owner;
- a new episodic record at the next free number and the INDEX pointer;
- a rebuilt `dist/`.

Your final message: open decisions first if any, then changed areas, the
checks you ran with pass counts pasted from output, the evidence behind each
goal item, residual risks, deferred work, and the reinvocation command if the
run is not terminal. Report only what you observed. A Chrome-dependent claim is
reported as unverified.

## Anti-patterns

### Don't let model output into the extension context

Why: Manifest V3 bans runtime-evaluated code in extension pages, and a
`postMessage` payload that the side panel `eval`s or injects as a script is
exactly that. Store review rejects it and the CSP blocks it.

Instead: the side panel sends `viz.load` with identifiers, and the viewer
fetches and runs the artifact inside its opaque-origin sandbox.

### Don't put a model where a command works

Why: asking Sonnet to read slide text off a PNG, guess a fingerprint, or judge
whether a manifest is valid JSON costs money, drifts run to run, and hides
failures behind plausible output. The spec's whole reliability story is that
the deterministic stages never vary.

Instead: `pdftotext`, the shared dhash module, Zod, and the harness do those
jobs; the model gets their output as input.

### Don't let retrieval override what is on the slide

Why: the textbook says the algorithm has five steps; the slide shows three.
A description that reports five has described the book, not the slide, and a
blind student following the lecture is now out of sync with everyone else.

Instead: excerpts supply terminology, notation, parameters, and citations.
What the slide shows is decided from the slide's image and text alone.

### Don't let a model cite what it was not shown

Why: a citation is a promise the student can check. A page number the model
guessed, or a quote it paraphrased, is worse than no citation because it
looks verified.

Instead: references pass only when the quote is a verbatim substring of an
excerpt in that call's input; the verifier drops the rest and logs the count.

### Don't let the describer invent

Why: charter A3 makes machine descriptions drafts, but a confident wrong
description that an instructor skims past becomes what a blind student hears.
The prototype's rules already forbid interpreting intent or adding facts not
visible; a port that loosens them to raise acceptance rate has broken the
product.

Instead: keep the `build-pack.ts` rules verbatim in the Pack Author prompt, and
give the model the extracted text so it does not have to guess at small print.

### Don't skip the harness for seeded artifacts

Why: a catalog item that never rendered under our CSP will pass retrieval, get
approved on the strength of its screenshot from the original site, and break
in front of students.

Instead: wrap, run the harness, then embed. No vector without a passing render.

### Don't fit prompts to the test deck

Why: a planner or describer prompt tuned until every slide in the HNSW deck
comes out perfect has learned that deck, and the biology professor's deck will
get nonsense.

Instead: hold out at least two subjects from prompt iteration, and report hit
rate on the held-out slides separately.

### Don't hide logic in the extension that the API does not expose

Why: the point of the API is that a dashboard or a CLI can replace the
extension's authoring views without loss. A review decision computed
client-side and never sent, or an upload flow that depends on extension
storage, silently makes the extension the only working client.

Instead: the extension's authoring code is fetch calls plus rendering. If a
behavior needs state, it lives in the job record and is reachable by a route.

### Don't claim deployed without invoking

Why: `cdk deploy` succeeding proves resources exist, not that the Lambda has
the right IAM to call Bedrock or that the API returns anything.

Instead: every deploy lane ends with a curl or SDK call through the real
endpoint and pastes the response into its evidence.

### Don't leave two writers in one checkout

Why: the async-subagents skill records the observed outcome: two lanes,
seventeen shared files, tree discarded. This checkout is also used by the
user from other sessions, so the margin for error is zero.

Instead: one writer per worktree, always; use read-only lanes to fill spare
capacity, and never point a writing child at the root checkout while it is
dirty with files that are not yours.

### Don't edit another part's directory without a thread

Why: the relay exists because five people merge into one branch, and a silent
edit to `packMedia.ts` or `contracts.ts` is exactly the kind of change that
surfaces as someone else's merge conflict with no explanation attached.

Instead: open the thread first, name the file and the reason, make the
smallest edit, and cite the thread ID in the commit message.

### Don't reopen settled design to dodge a hard step

Why: the spec's shape is what makes retrieved, adapted, and generated outputs
interchangeable downstream. Swapping the sandbox for a plain iframe, or
skipping the artifact manifest for generated code, breaks that seam for every
later stage.

Instead: if a settled decision is truly infeasible, write it up as a decision
with the evidence and end the turn.

### Don't store anything about a student server-side

Why: invariant A4 has no exception for "just a connection count with a name".
The authoring pipeline has no reason to know a student exists.

Instead: student state is extension-local; the server sees the instructor's
job and the published pack, nothing else.

## Hard rules

1. Generated or retrieved artifact code runs only inside the viewer's
   opaque-origin sandbox, never in an extension page.
2. Nothing reaches `packs/`, `media/`, or `artifacts/` without an instructor
   approval recorded in the job, and a slide the describer cannot describe
   gets empty regions and a review flag, never a guess.
3. No student identifier, preference, or connection record is written to any
   AWS resource by this feature.
4. `LiveEvent` gains no new types; `AccessPack` gains only the optional
   `visualization` and `references` per asset and `audioUri` per region;
   `arScene` is never written.
5. Every artifact, seeded or generated, passes the harness before it is
   embedded, published, or shown to the instructor.
6. Only Sonnet 4.6 and Titan embed v2 are called on Bedrock, and Bedrock and
   Polly are called only from Lambda.
7. Agent prompts live in `docs/prompts/viz/` and are authored by you or a
   `sol` lane; support lanes make only mechanical edits to them.
8. One writing child per checkout; parallel writers use separate worktrees
   with the canonical `--store-cwd`; Codex GPT-5.5 is read-only and never
   edits or touches AWS.
9. CDK deploys are serialized, every deploy ends with a real invocation, and
   `make deploy` and `make destroy` work from a clean checkout.
10. All resources carry `RemovalPolicy.DESTROY` and the teardown command is in
    the handoff.
11. User decisions go to `docs/VIZ_DECISIONS.md` and end the turn; nothing in
    the escalation list is decided unilaterally, and nothing outside it is
    escalated.
12. Edits outside Part 6's directories are limited to the four named
    cross-part edits, each with an open relay thread cited in the commit.
13. Every milestone starts with failing tests and lands as its own commit
    naming its V-ID.
14. `make check` passes including `relay_check.py`, `git status` is clean,
    the relay has your closing entry, and the INDEX pointer names the new
    episodic record before you report done.
15. Course library files are private to the profile; no route returns a whole
    document to anyone but the owning instructor, quotes are capped at 300
    characters, and a reference survives only the verbatim substring check.
