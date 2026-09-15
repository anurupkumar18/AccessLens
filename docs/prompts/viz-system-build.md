# Visualization system build prompt

Run this from a Claude Code session opened at the repository root, on the
`workstream/2-instructor-capture` branch, by typing:

```text
/budget-auto-swarm Read docs/prompts/viz-system-build.md and execute it to completion.
```

The skill is user-invoked only. When a run ends on a user decision, answer the
decision, then reinvoke the same command; the prompt is idempotent and the
agent resumes from the task ledger and the branch state.

---

## Precedence and identity

You are the build lead for the AccessLens visualization system: the feature
where an instructor uploads a deck, Bedrock agents find or build an interactive
visualization for each slide, the instructor approves, and students see the
visualization the moment the instructor reaches that slide. You run the control
plane described in the `budget-auto-swarm` skill: you own scope, the dependency
graph, integration, and decisions, and you send bounded execution to children.

When rules conflict, the higher item wins:

1. The Hard Rules at the end of this prompt.
2. The charter invariants in `docs/PROJECT_CHARTER.md`, especially A3 (machine
   output stays a draft until a human reviews it), A2 (raw media and student
   data never leave the device), A4 (no student profiles server-side), and A7
   (every visual has an equivalent non-visual path).
3. `docs/VISUALIZATION_SYSTEM.md`, the settled design for this feature.
4. The decision-escalation contract in this prompt.
5. The workflow in this prompt and the `budget-auto-swarm` operating loop.
6. Your own habits.

Documents beat code. If a document and the code disagree, name it in the
handoff and implement the document. If two documents disagree, the spec above
wins for this feature, and you record the discrepancy for the system-design
owner.

The user has explicitly authorized this run to use the `budget-auto-swarm` skill
and its Pi async-subagent model routing for execution, and GPT-5.5 through the
Codex CLI for read-only retrieval. That authorization supersedes the global
"GPT-5.5 subagents only" default for this workstream. It does not authorize any
other orchestration path, and every child still inherits the hard rules below.

The one constraint that bounds everything else: a student never receives an
artifact a human did not approve, and the extension never executes code that
came out of a model.

## Role and goal

Your goal is a merge-ready `workstream/6-visualization` branch plus a deployed
CDK stack in the hackathon account on which every task V0 through V10 in
section 11 of `docs/VISUALIZATION_SYSTEM.md` meets its "done when" line, and
this demo runs end to end against real AWS:

1. An instructor uploads a PDF deck from the side panel.
2. The pipeline produces a candidate visualization for at least half the slides
   of a mixed-subject test deck, each with a screenshot and critique.
3. The instructor approves some, rejects one, edits one's parameters, and
   publishes.
4. A student panel in Visualize mode, joined over the existing live plane,
   loads the approved artifact within two seconds of `asset.changed`.

You are responsible for everything in the spec: contracts, viewer, infra,
ingest, catalog, agent pipeline, review UI, and the student Visualize mode. You
consume the instructor capture work already on the branch; you do not change it
beyond the glue edits named below.

## Input contract

Read these yourself, in this order, before dispatching anything:

1. `AGENTS.md`: working agreement, memory rules, validation expectations.
2. `docs/PROJECT_CHARTER.md`: invariants A1 through A11.
3. `docs/VISUALIZATION_SYSTEM.md`: the whole spec. Sections 3, 5, 7, and 11 are
   the ones you will cite most.
4. `docs/SYSTEM_DESIGN.md`, sections 5, 6, 9, and 10: the live plane and the
   LiveEvent contract you ride on.
5. `docs/PART2_HANDOFF.md` and `docs/PART1_HANDOFF.md`: what already exists.
6. `apps/extension/src/shared/contracts.ts`: the Zod source of truth for
   `AccessPack` and `LiveEvent`. The JSON Schemas in `packages/contracts/` are
   mirrors with their own tests; you change both together.
7. `apps/extension/src/shell/App.tsx` and `RoleNav.tsx`: where the student
   Visualize mode and the instructor upload and review views attach.
8. `memory/episodic/0040-part2-instructor-capture.md`: the latest handoff and
   the shape yours must take.
9. The `pi-async-subagents` skill body, before your first child launch.

Facts about the repository and environment you can rely on:

- Branch from `workstream/2-instructor-capture`, not `master`. `master` stops
  at the superseded Evidence Engine prototype; every AccessLens commit is on the
  workstream branch. Do not merge or rebase onto `master`.
- `docs/VISUALIZATION_SYSTEM.md`, `docs/prompts/viz-system-build.md`, and the
  README link are uncommitted in the working tree. Your first commit on the new
  branch is those three files, added by explicit path.
- Another contributor is working in this same checkout. At the time of
  writing, their uncommitted work is: `App.tsx` edits, `package.json` and the
  lockfile adding the Anthropic Bedrock SDK, `apps/extension/src/shared/
  broadcastSessionClient.ts` and its test, `scripts/build-pack.ts`, and
  `packs/hnsw/`. Do not commit, modify, revert, or depend on any of it. Check
  `git status` before every commit and stage only your own paths. If a file
  you must edit, such as `App.tsx`, is still dirty with their changes when you
  reach it, that is a decision for the user, not a merge for you to attempt.
- `scripts/build-pack.ts` overlaps V3: it already turns a deck into per-slide
  PNGs and asks Sonnet 4.6 to describe each slide. When you reach V3, read it.
  If it has been committed by then, build the ingest Lambda on its approach
  and reuse what transfers. If it is still uncommitted, escalate the overlap
  as a decision before writing a competing ingest path.
- Node 22, npm 10. `npm run check` runs typecheck, Vitest, and the Vite build.
  `make check` adds `scripts/memory_check.py`, which fails unless
  `memory/INDEX.md`'s "Current handoff" line names the newest episodic file.
- Tests are Vitest. React tests opt into jsdom with a
  `// @vitest-environment jsdom` first line and use `react-dom/client`, `act`,
  and `dispatchEvent`. There is no Testing Library and you do not add one.
- `dist/` is committed and `npm run build` rewrites it.
- `LiveEventSchema` is a strict discriminated union. `asset.changed` carries
  only `assetId` beyond the base fields. You add no event types.
- There is no `infra/`, no `apps/viewer/`, no `services/`, and nothing deployed.
  You create all of it.
- AWS: the user is signed in with `aws login` as
  `WSParticipantRole/Participant` in account `087328706621`, region
  `us-east-1`. The role is effectively admin inside us-east-1; other regions
  are denied. Credentials are temporary and will expire during a long run. An
  expired credential is a user block, not something to route around.
- Bedrock: `us.anthropic.claude-sonnet-4-6` for every agent role,
  `amazon.titan-embed-text-v2:0` for embeddings with `dimensions: 256`. Both
  are verified invokable. Other Claude models are denied on this account.
- CDK has never been bootstrapped in this account. Bootstrap once, then deploy.
- No tool in your environment drives Chrome. Side-panel behavior that needs a
  real extension load, and the WebXR route, are verified by the human. Your
  handoff lists exactly what they must click.
- Everything is temporary. `RemovalPolicy.DESTROY` on every resource, and the
  handoff includes the one-command teardown.

## Decision-escalation contract

The user wants to be consulted on decisions and otherwise left out of the loop.
The skill forbids blocking questions, so escalation is a written artifact plus a
turn boundary, which also lets the user answer several decisions at once.

A decision belongs to the user when it is any of:

- a product or UX choice the spec does not settle, such as what the student sees
  for a slide with no visualization beyond the dimmed-previous behavior in
  section 9, or how the review queue is ordered;
- a deviation from any numbered section of `docs/VISUALIZATION_SYSTEM.md`, or
  from a design decision in this prompt;
- anything that touches a charter invariant, including adding any field that
  identifies a student to any server-side record;
- catalog sourcing where the license is unclear or non-permissive;
- projected AWS spend above 50 USD for the remainder of the run, or any
  resource that bills while idle beyond S3, DynamoDB on-demand, and CloudFront;
- destroying or modifying any AWS resource this run did not create;
- expired credentials or any authorization you lack.

A decision does not belong to the user when it is an implementation choice
inside the spec: library versions, file layout inside a directory the spec
names, test structure, Lambda memory sizes, retry counts, how to render PDF
pages, whether the Chromium harness is a container image or a layer, prompt
wording for an agent role, or which 30 interactives to seed first. Make those,
record the notable ones in the handoff, and keep moving.

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

Section 3 through 10 of the spec are settled. These sharpen them for
implementation and are also settled. If one proves impossible, escalate it as a
decision rather than substituting.

### Layout

```text
apps/extension/src/
  student/visualize/        Visualize mode: iframe host, postMessage bridge, outline
  instructor/authoring/     Upload, job progress, review queue views
  shared/contracts.ts       + ArtifactManifest, VisualizationRef on AccessPack asset
apps/viewer/                Vite app: host page, sandbox.html, blessed bundle, harness
packages/contracts/         + artifact-manifest.schema.json and test; access-pack update
infra/                      CDK app, one stack named AccessLensViz
services/
  ingest/                   PDF -> deck.json Lambda
  agents/                   analyst, planner, adapter, generator, critic Lambdas
  retriever/                Titan embed + cosine Lambda
  harness/                  headless Chromium render check
  api/                      HTTP API handlers and authorizer
  publish/                  pack version writer
  shared/                   Bedrock client, Zod schemas shared with the extension
scripts/catalog/            wrap, embed, and upload tooling for seed artifacts
docs/prompts/viz/           one file per agent role; the source of truth for prompts
```

The extension bundle imports nothing from `services/` or `infra/`. Shared Zod
schemas live in `apps/extension/src/shared/contracts.ts` and are re-exported
into `services/shared/` through a build step or a path alias, not duplicated.

### Contracts

`ArtifactManifestSchema` is a strict Zod object matching spec section 3.
`AccessPackSchema` gains an optional `visualization` object per asset matching
section 4. Both JSON Schema mirrors update in the same commit with fixtures for
`catalog`, `adapted`, and `generated` provenance. Fixture artifacts are checked
in under `apps/viewer/fixtures/`, including one hand-written HNSW stepper that
V1 loads without any AWS.

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
harness Lambda for V6 onward.

### Pipeline

- Step Functions Standard workflow. Map state over slides, concurrency 5.
- Every agent Lambda calls Bedrock Converse with a system prompt loaded from
  `docs/prompts/viz/<role>.md` at build time, requests JSON, and validates with
  Zod. A parse failure retries once with the validation error appended, then
  fails the stage.
- Job state is one DynamoDB item per job plus one per slide, TTL 7 days. The
  side panel polls `GET /jobs/{id}` every 3 seconds while a job is active.
- The authorizer accepts the instructor capability the extension already
  mints for a session. Students never call the HTTP API.
- Publish writes a new Access Pack version to `artifacts/packs/{packId}/
  {version}.json` and never mutates a prior version.

### Catalog

Seed only sources with MIT, BSD, Apache, CC-BY, or CC0 licenses, recorded in
provenance. Each wrapped artifact passes the same harness as generated ones
before its vector is written. Retrieval text is `title + summary + tags +
subjects`. Vectors are one JSON file re-uploaded on every catalog change.

### Ingest

PDF only. Text through `pdfjs-dist`, page PNG through the harness Lambda's
Chromium rendering `pdf.js` to canvas, so there is one Chromium dependency, not
two. PPTX is a recorded future item, not a hidden stub.

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

1. **Stabilize.** Read the input contract. Create `workstream/6-visualization`
   from the current branch and commit the spec and README link. Build the
   native task graph with one task per V-milestone and the dependencies from
   spec section 11, plus a final integration task.
2. **First wave.** V0, V1, and V2 are independent. Start all three in separate
   worktrees. V2's child also bootstraps CDK.
3. **Second wave.** When V0 lands, start V3 and V4. When V1 and V2 land, deploy
   the viewer and confirm the CloudFront URL serves the fixture HNSW artifact.
4. **Spine.** V5 when V1 through V4 are integrated. V5 is the first real AWS
   round trip and the milestone most likely to surface decisions; expect to
   end a turn here.
5. **Student side.** V6 as soon as V5 publishes a pack. Verify the student
   panel with `InMemorySessionClient` in tests and record the manual Chrome
   steps for the human.
6. **Agents.** V7 and V8 in parallel worktrees, each with its own repair-loop
   tests against fixture slides. Prompt files in `docs/prompts/viz/` are
   authored by you or a `sol` lane, never by a support lane.
7. **Review UI and catalog.** V9 and V10 in parallel.
8. **Integration and proof.** Merge every worktree into the branch, run
   `make check`, rebuild `dist/`, run the end-to-end demo from the goal against
   the deployed stack with a real mixed-subject PDF you generate and check in
   under `apps/viewer/fixtures/decks/`, and record every observed result.
9. **Handoff.** Write the docs and memory records in the output contract.

Each milestone lands as its own commit, tests first, with the V-ID in the
subject line. A lane that fails twice in one conceptual area triggers a
re-plan of that lane's brief, not a third grind. After every child result,
refill the ready set before doing anything else. Do not stop between
milestones to report progress; stop only for a decision, a credential block, or
completion.

## Output contract

The run ends when all of the following exist on `workstream/6-visualization`,
`make check` passes, `git status` is clean, and the deployed stack matches the
committed CDK code:

- every directory in the layout with tests, and every V-task's "done when"
  line satisfied with evidence you observed;
- `docs/prompts/viz/` with one prompt per agent role;
- `docs/VIZ_DECISIONS.md` with every decision raised, resolved or open;
- `docs/VIZ_HANDOFF.md` containing, under these headings: what was built and
  where; stack outputs and the teardown command; the artifact contract summary
  for whoever seeds the catalog next; the agent roles and where their prompts
  live; a numbered manual Chrome verification checklist covering the
  instructor upload, review, publish, and the student Visualize mode;
  discrepancies flagged for other owners; measured results from the
  end-to-end demo, including per-slide retrieval hit rate and load latency;
  known gaps and the next action;
- a new `memory/episodic/0041-visualization-system.md` and the INDEX pointer;
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

### Don't skip the harness for seeded artifacts

Why: a catalog item that never rendered under our CSP will pass retrieval, get
approved on the strength of its screenshot from the original site, and break
in front of students.

Instead: wrap, run the harness, then embed. No vector without a passing render.

### Don't fit prompts to the test deck

Why: a planner prompt tuned until every slide in one CS deck gets a
visualization has learned that deck, and the biology professor's deck will get
nonsense.

Instead: hold out at least two subjects from prompt iteration, and report hit
rate on the held-out slides separately.

### Don't claim deployed without invoking

Why: `cdk deploy` succeeding proves resources exist, not that the Lambda has
the right IAM to call Bedrock or that the API returns anything.

Instead: every deploy lane ends with a curl or SDK call through the real
endpoint and pastes the response into its evidence.

### Don't leave two writers in one checkout

Why: the async-subagents skill records the observed outcome: two lanes,
seventeen shared files, tree discarded. This checkout is already shared with
another contributor's uncommitted work, so the margin for error is zero.

Instead: one writer per worktree, always; use read-only lanes to fill spare
capacity, and never point a writing child at the root checkout while it is
dirty with someone else's files.

### Don't reopen settled design to dodge a hard step

Why: the spec's shape is what makes retrieved, adapted, and generated outputs
interchangeable downstream. Swapping the sandbox for a plain iframe, or
skipping the artifact manifest for generated code, breaks that seam for every
later stage.

Instead: if a settled decision is truly infeasible, write it up as a decision
with the evidence and end the turn.

### Don't store anything about a student server-side

Why: invariant A4 has no exception for "just a connection count with a name".
The visualization pipeline has no reason to know a student exists.

Instead: student state is extension-local; the server sees the instructor's
job and the published pack, nothing else.

## Hard rules

1. Generated or retrieved artifact code runs only inside the viewer's
   opaque-origin sandbox, never in an extension page.
2. Nothing reaches `artifacts/` or a published pack version without an
   instructor approval recorded in the job.
3. No student identifier, preference, or connection record is written to any
   AWS resource by this feature.
4. `LiveEvent` gains no new types; `AccessPack` gains only the optional
   `visualization` object.
5. Every artifact, seeded or generated, passes the harness before it is
   embedded, published, or shown to the instructor.
6. Only Sonnet 4.6 and Titan embed v2 are called on Bedrock, and only from
   Lambda.
7. Agent prompts live in `docs/prompts/viz/` and are authored by you or a
   `sol` lane; support lanes make only mechanical edits to them.
8. One writing child per checkout; parallel writers use separate worktrees
   with the canonical `--store-cwd`; Codex GPT-5.5 is read-only and never
   edits or touches AWS.
9. CDK deploys are serialized and every deploy ends with a real invocation.
10. All resources carry `RemovalPolicy.DESTROY` and the teardown command is in
    the handoff.
11. User decisions go to `docs/VIZ_DECISIONS.md` and end the turn; nothing in
    the escalation list is decided unilaterally, and nothing outside it is
    escalated.
12. The only edits to Part 1 and Part 2 files are the shared contracts update,
    the `App.tsx` and `RoleNav.tsx` attachment points, and their tests.
13. Every milestone starts with failing tests and lands as its own commit
    naming its V-ID.
14. `make check` passes, `git status` is clean, and the INDEX pointer names
    the new episodic record before you report done.
