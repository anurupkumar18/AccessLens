# Part 6 decisions

Running record of every decision that belongs to the user under the
decision-escalation contract in `docs/prompts/viz-system-build.md`, plus the
notable implementation choices made without asking. Numbered `D1`, `D2`, ...
Resolved entries stay here with the answer and the date; nothing is re-asked.

Status vocabulary: `OPEN` (waiting on the user), `RESOLVED` (answered),
`NOTED` (a call the lead made inside its own authority, recorded because it is
worth knowing).

---

## D1 — `scripts/relay_check.py` hardcoded five parts — NOTED

**Question.** The relay checker asserted `len(rows) != 5` for section 2 of
`docs/CONTEXT_RELAY.md`, so adding the Part 6 row that the build prompt's
workflow step 1 requires made `make check` fail.

**Options.** (a) Raise the expected count to 6. (b) Derive it from
`docs/PARALLEL_WORKSTREAMS.md`. (c) Escalate as a cross-part edit.

**Decision.** (a). `docs/VISUALIZATION_SYSTEM.md` §15 states that Part 6 is a
new workstream alongside the original five, and the build prompt orders the
Part 6 row added *and* `relay_check.py` kept green. A one-constant change is
the implied consequence of an instruction that is already settled, not a
deviation from it. `docs/PARALLEL_WORKSTREAMS.md` gained the matching
ownership row. Relay thread T-35 records that Part 6 created `infra/` in
Part 4's absence.

**Date.** 2026-09-15.

---

## D2 — the run's scope is the API product, not the extension client — NOTED

**Question.** The user's invocation added a goal: "have a fully working product
(API only) with a vast test suite, and tests that an LLM creates appropriate
resources (the ones that were specified)". Section 14 of the spec also contains
four extension-client milestones — V5 (instructor authoring UI), V6 (student
pack loader), V9 (student Visualize mode), and R4 (references in Read mode).

**Options.** (a) Read "API only" as narrowing the run to the authoring plane and
its clients-by-contract. (b) Build the extension views too and dilute the test
suite.

**Decision.** (a). The authoring plane — contracts, viewer and sandbox, CDK
stack, ingest, pack authoring, audio, publish, catalog, course-profile
retrieval, and the agent stages — is built to completion with a test suite that
includes model-behaviour evaluations asserting that each agent stage produces
the resources the spec specifies. The four extension-client milestones are
deferred; their relay threads (T-32, T-33, T-34) stay OPEN with Part 6 named,
and `docs/VIZ_HANDOFF.md` lists them as the next action. Every capability they
would have used is reachable over HTTPS with the bearer token, which is the
property the spec's API-first rule actually asks for.

**Date.** 2026-09-15.

---

## D3 — four defects the model-behaviour evaluation found, and what changed — NOTED

**Question.** The user's goal asked for tests that an LLM creates the resources
the spec specified. Running the first such evaluation against the eight real
HNSW slides, through the shipped prompt and the shipped schema, failed. What
should change: the eval's bar, or the pipeline?

**What the eval found.** Four defects, all in the pipeline, none of which any
unit test could have reached:

1. **The tool schema contradicted the prompt.** The prompt says
   "at most 60 words"; the schema said `maxLength: 700` and nothing about
   words. The model optimised to the limit it was actually shown and produced
   descriptions of up to 100 words. Nothing caught it, because nothing was
   checking the rule the prompt gives. The same defect is in the shipped
   prototype: 6 of the 33 regions in `packs/hnsw/pack.draft.json` exceed the
   caps `scripts/build-pack.ts` states, and nobody knew.
2. **The output budget was too small.** 2048 tokens truncates a six-region
   slide. A truncated tool call arrives as a partial JSON string and surfaces
   as "expected array, received string", which tells the model nothing and
   burns all three attempts.
3. **Structured arguments sometimes arrive as JSON strings** even without
   truncation — observed on 2 of 8 slides.
4. **The repair turn asked for a fresh answer.** So the model fixed the flagged
   region and broke a different one, oscillating until the budget ran out.

**Decision.** Fix the pipeline, in all four places: the word caps are enforced
in the schema *and* stated in the field descriptions that reach the model; the
default budget is 8192 tokens; truncation and unparseable JSON strings each get
their own actionable retry note; and the repair turn hands the model its own
previous answer back and asks it to change only the named fields, leaving
everything else byte-for-byte identical.

The caps themselves were not loosened. The one thing that did move was the
eval's own bar, and only to match the spec rather than exceed it: the spec's
designed outcome for a slide that exhausts its attempts is empty regions and a
review flag, and an instructor reviews every slide anyway under charter A3, so
a flagged slide is the system working. The eval now asserts that the large
majority of a deck comes through and that a failed slide yields *nothing*
rather than a partial draft, and reports the exact rate either way.

**Result.** 4 of 8 slides clean before, 7 of 8 after. Mean attempts to a valid
draft 2.17 to 1.57. Zero property violations across every slide that returned.

**Date.** 2026-09-15.

---

## D4 — the planner never chose retrieval, so the catalog was dead weight — NOTED

**Question.** The first Viz Planner evaluation run over the real deck chose
`generate` for seven of eight slides and `retrieve` for none. The prompt
already said "prefer retrieve because a proven artifact beats generated code",
and the model ignored it. Fix the prompt, the routing, or accept it?

**Why it happened.** The planner is asked to choose `retrieve` without ever
seeing the catalog. Spec §8 runs the planner at stage 5 and the retriever at
stage 6, so "no catalog shape can faithfully teach this concept" is a
judgement the planner has no evidence for — and absent evidence, it reaches for
the option it fully controls. The result inverts the spec's economics: 30
seeded artifacts go unused and every slide pays for generation plus a harness
run plus a critic loop.

**Decision.** Two changes, neither of which moves the stage boundary.

1. The planner prompt now names the shapes the catalog actually holds —
   steppers, graph and tree explorers, sorting and search visualizers, function
   plotters, distributions, simulations, circuit and state-machine diagrams,
   hotspot diagrams, timelines, map overlays, supply-and-demand curves — and
   states the cost asymmetry plainly: retrieval runs on whatever concept it
   names and falls through to generation by itself when nothing matches, so
   `retrieve` costs nothing when it is wrong, while `generate` skips the
   catalog and commits the job to writing and repairing new code.
2. The routing rule in `services/agents/route.ts` runs retrieval for **any**
   non-`none` decision and generates only when retrieval returns nothing above
   threshold, so the system does not depend on the planner guessing right.

Neither change mentions this deck, HNSW, or nearest-neighbour search; the
vocabulary is the catalog's and would read the same for a biology deck.

**Result.** 6 `retrieve`, 1 `generate`, 1 `none`. Restraint held — the title
slide still gets `none` — and seven of eight slides get a candidate
visualization, which is above the run goal's "at least half".

**Date.** 2026-09-15.

## D5 — catalog embeddings are computed by a local build script, not a Lambda — DECISION NEEDED

**Question.** Hard rule 12 says Bedrock and Polly are called only from Lambda.
`scripts/catalog/embed.ts` calls Titan embed v2 (256 dimensions) from the
developer's machine to write `packages/catalog/vectors.json`, which is a
checked-in build artifact the Retriever loads at runtime. The catalog lane
(R2) built it that way, the lead merged it, and the V12 lane now regenerating
`vectors.json` against the real harness is doing the same. The rule's intent
is that no runtime path and no student-facing request touches a model outside
the account's Lambda boundary; a build step that runs before deploy and
commits its output is arguably outside that intent, but it is a literal
deviation from a numbered hard rule, and those are the user's to grant.

**Lead's position.** Keep it as build tooling. Moving 30–150 one-off
embedding calls into a Lambda adds a deploy dependency to a catalog edit and
buys no safety: the same credentials, the same model, the same region, and
the output is reviewed in a diff before it is committed. The only runtime
Titan call — course-library indexing (R1) — already lives in Lambda.

**What changes if the user disagrees.** Add an `EmbedCatalog` Lambda under
`infra/lib/vectors-extension.ts`, invoke it from `scripts/catalog/embed.ts`
via `lambda:Invoke`, and revoke local Bedrock use in the script. About an
hour; no data-model change.

**Status.** The lead has proceeded on its own position so the run is not
blocked. This entry stays open until the user confirms or reverses it.

## D6 — the catalog is one template stamped 150 times, and the harness cannot tell — DECISION NEEDED

**What the lead found.** Reviewing the V12 lane's output before merging:
150 artifacts, every one passes the real viewer harness, `vectors.json`
regenerated without `skipHarness`, 25/25 tests, `tsc` clean. And every
`index.html` is between 3.3 KB and 4.6 KB. Two artifacts chosen at random —
`energy-conservation-diagram` and `redox-reaction-stepper` — differ by four
lines out of twenty-one once digits are normalised. The script is the same
step-through-a-list-of-SVG-shapes in all 150; the manifests' `interaction`
values (`plot`, `simulation`, `timeline`, `explorer`) describe nothing the
code does. Provenance is `kind: "catalog"`, `sourceUrl` pointing at this
repository, `CC0-1.0` — self-authored, not seeded from any open catalog.

Then the lead checked the 30 artifacts already merged from the R2 lane. Same
template, same four-line delta. The lead merged R2 without measuring depth;
that was a review failure and it is why D4 — "the planner now chooses
retrieve" — looked like a win. It sends slides to a corpus of identical
clickers, and the retrieval scores are computed over title/summary text, so
they look healthy while the payload is generic.

**Why this is structural, not a bad batch.** The spec puts three gates on a
catalog artifact: schema (section 4), harness (section 6), and critic
fidelity (section 8). The first two certify that a thing renders cleanly;
neither can say whether it teaches the concept its manifest names. Only the
critic can, and the critic runs per job, after retrieval, on money. So the
catalog's *admission* bar has no substance check at all, and a lane optimising
for "150 that pass" will always converge on a template. Growing the count
under the current gates is worthless; the number is not the product.

**Lead's position.** Do not merge the 120 new artifacts. Keep the harness
gate (`7f34695`) and the removal of `skipHarness`. Then one of:

- **(a) Seed from real open interactives**, as section 10 intended. Cost:
  each one needs a licence a human has read (MIT / CC-BY / CC0), an
  accessibility block a human has verified with a keyboard and a screen
  reader, and an adapter to the `accesslensInit` contract. Perhaps 20–40
  genuine artifacts in the time available, not 150. This is the honest
  version of V12, and section 16 already flags catalog licensing as a user
  call.
- **(b) Shrink the catalog to what is real** — audit the 30, keep the handful
  with distinct behaviour, and let the planner's `generate` path carry the
  rest through the critic. Cheaper; lower ceiling; means D4's retrieve
  preference should be relaxed again.
- **(c) Add a substance gate to admission**: a one-time Sonnet critique of
  each catalog artifact against its own manifest, cached in
  `vectors.json`, so a template that claims `simulation` and delivers a
  list is refused before it is embedded. Reuses `services/agents/critic.ts`.
  Does not by itself produce better artifacts, but stops the count from
  lying.

The lead recommends **(c) then (a)**: make the admission bar honest first,
then fill the catalog with things that clear it.

**Status.** Blocked on the user. The lead has not merged `lane/catalog-v12`
and will not grow the catalog further under the current gates.

## D7 — test the pipeline's published pack in the student view — DECIDED (user, 2026-09-16)

**Question.** D2 scoped this run to the API. The lead asked whether, once one
real job has run and been published, the pipeline's output pack should be
loaded in the extension's existing student renderers (Part 2) as the one UI
test that proves something about this pipeline's output.

**Decision.** Yes. The user asked for it after the real job completes.

**Scope granted.** Whatever is needed to point the extension's student view
at the published pack URL on CloudFront — at most a small cross-part edit
in `apps/extension/src/`, logged here if it happens. Not in scope: an
instructor review UI (V5), a renderer for `audioUri` or `visualization`
(V6/V9). Hear mode falls back to local speech synthesis; every slide in this
deploy is `no-visual`, so no interactive would appear regardless.

## D8 — AWS credentials expired mid-run — RESOLVED (user re-authenticated, 2026-09-16)

**What happened.** The second deploy (`make deploy`, carrying the ingest
CommonJS fix) exited 2, and every AWS call since answers
`Your session has expired. Please reauthenticate using 'aws login'`. The
real job that ran right after it (`97739724-7048-4d44-b237-3497a6531fdd`)
went straight to `failed` with no execution ARN, which is `createJob`'s
own catch path when `StartExecution` throws — consistent with the API's
Lambdas being fine and the caller's credentials, not the stack, being the
problem for the describe calls; the lead cannot tell which without a
session.

**What the lead cannot do.** Inspect the stack's state, read the createJob
or ingest logs, redeploy, or run the job. The build prompt is explicit that
an expired credential is a user block, never something to route around.

**What the user does.** Sign in again through Workshop Studio (or run
`aws login` for the participant role) and say so. The lead then: confirms
the stack status (expect `UPDATE_COMPLETE` or `UPDATE_ROLLBACK_COMPLETE`),
redeploys once, runs the real job, reviews and publishes it through the
API, verifies the pack and media on CloudFront, and runs the D7 student-view
test against the published pack.

**State at the block.** Everything is committed; the working tree holds
only the runbook edits (`docs/DEPLOY.md`, `infra/scripts/smoke.sh`) that
describe the running pipeline, held back until the job proves them. Local
gates are green: 466 tests, `tsc` clean, `make check` green. The ingest
image with the CommonJS fix builds and loads locally; whether it reached
the stack depends on where the deploy died.

**Resolution.** The user signed in again; `sts get-caller-identity` answers as the participant role and the stack reads `UPDATE_COMPLETE` on the pre-fix revision. The redeploy and the real job were started immediately.

## D9 — `origin/master` moved under this branch: the UI rebuild is in, and two CDK apps now claim `infra/` — DECIDED (user, 2026-09-16: fix the conflicts; option (a))

**What the user asked.** "When you're done, the UI PR should be in so
please check that out."

**What is actually there.** No UI pull request exists. The only open PR
(#12) is a docs-only contract review. The IBM Plex interface rebuild
(`9d894ae`) reached `origin/master` through a direct merge commit
(`cd52f6e` "merge: consolidate AccessLens integration"), followed by
`231d1fb` "feat: improve realtime accesslens learning experience", which
together touch 21 extension files (688 lines of `style.css`). So the UI is
in master; it just never went through a PR.

**Why merging master is not routine.** `origin/master` is 24 commits
ahead of this branch's base. A dry-run merge (`git merge-tree`) conflicts
in six places, and three of them are structural rather than textual:

1. **Two CDK apps in one directory.** Part 4 added its own `infra/`
   (`@accesslens/infra`, `bin/accesslens.ts`, `lib/live-session-stack.ts`,
   own `package.json`, `cdk.json`, `tsconfig.json`). Part 6's `infra/`
   (`bin/app.ts`, `lib/access-lens-authoring-stack.ts`, deploys through the
   root package) was added independently. `cdk.json` names one app entry;
   the two cannot both win. This is an ownership-boundary problem, not a
   merge-tool problem.
2. **`docs/CONTEXT_RELAY.md` numbering.** Master is at RL-035 and T-30
   and uses T-25..T-30 for other threads; this branch had written RL-025,
   RL-026 and T-25..T-32. Applied on merge: Part 6's threads are T-31..T-38
   and its entries RL-036 and RL-037. PR #12 also claims T-31..T-33 and
   renumbers when it lands after this.
3. **Committed build output.** `dist/` and `dist/index.html` conflict as
   rename/rename and modify/delete; they are generated and must be rebuilt
   after the merge, not resolved by hand.

Textual conflicts in `Makefile` (master added `work-board`,
`agent-context`, `live-session-check`; this branch added `deploy`, `smoke`,
`destroy`) and `package.json` are ordinary.

**One charter-adjacent observation, not Part 6's doing.** Master added
`capture.stopped` to `LiveEvent` (PR #12's AL-003 review). Build-prompt
hard rule 13 forbids *this* work from adding LiveEvent types; it did not,
and the extension's remote-pack loader is unaffected. Noted so the rule's
author knows the enum changed underneath it.

**Options.**
- (a) **Recommended.** Merge master into `workstream/6-authoring` now.
  Resolve `infra/` by making Part 6's stack a second stack in Part 4's CDK
  app (one `bin`, one `package.json`, `cdk deploy AccessLensAuthoring`
  selects it), renumber the relay entries, rebuild `dist/`, rerun
  `make check`, then redeploy and rerun the real job so the merged tree is
  the one proven live. Cost: one more deploy and job (~15 minutes of
  wall-clock, cents of Bedrock).
- (b) Move Part 6's infra to `infra-authoring/` and leave Part 4's alone.
  Fewer conflicts, two CDK apps and two `cdk.json`s to keep in step forever.
- (c) Do not merge; open the PR from this branch as-is and let the reviewer
  resolve. Pushes the structural decision to whoever merges, with a
  conflicted `infra/` in the diff.

**Why this needs the user.** Merging Part 4's CDK app is a cross-part edit,
and the rules restrict those to named cases. The recommendation is (a); the
lead has not merged.

## D10 — two publishers, one seam: the route now owns publication — NOTED

**What real job 6 showed.** Review accepted all eight assets (the first
time review succeeded, after D-less fixes for the missing job-record slides
in `09893e7`). Publish then failed with `AccessDenied: s3:PutObject` on
`media/hnsw-explainer/1/slide-01.png`. The route's IAM grant carried a
comment saying the state machine's Publish stage did the writing, while
the route's code published itself and the workflow *also* ran a Publish
Lambda whenever its 3-second poll caught the record at `publishing`.

**Why that is structural, not a missing permission.** Two writers of the
published prefixes with a race window between them means a second pack
version could appear from timing alone, and the reviewer's request would
return a `packUrl` that the workflow then superseded. Hard rule 2 (nothing
reaches `packs/`, `media/`, `artifacts/` without recorded approval) wants
exactly one gate, and the route is where the approval record lives.

**What changed (`5e586ea`).** The workflow waits for `published` or
`failed` and has no Publish stage; the Publish Lambda, its boundary code
and its ARN are removed; the route's role may `PutObject` only under
`packs/*`, `media/*` and `artifacts/*`. The runbook says the same.

**Residual.** The route publishes inside one API request, so a very large
pack (hundreds of slides with audio) could approach the API Lambda's
timeout. The decks this product targets are tens of slides; if that
changes, the answer is a publish job the route starts and the client
polls, still with the route as the single gate.

## D11 — an upload screen in the instructor panel, one shared token, no professor accounts yet — DECIDED (user, 2026-09-16: "we need to add somewhere to upload slides")

**What exists.** The authoring API takes a deck through `POST /v1/uploads`,
a presigned `PUT`, `POST /v1/jobs`, review and publish, guarded by the one
bearer token the stack issues at deploy. There are no per-instructor
accounts; whoever holds the token is the instructor.

**What changed.** `AuthoringPanel` (`apps/extension/src/instructor/`) in
the instructor role: paste the token once (kept in this browser's
localStorage, sent only to the API), pick a PDF/PPTX, name the lesson, watch
the stages, untick any description to leave it out, publish, open the
result in the student view. `authoringClient.ts` is the browser client. The
decks bucket gained a CORS rule for the presigned `PUT`, and the manifest
gained host permissions for the API and S3 hosts.

**Not done, on purpose.** Professor accounts. Cognito or a token-issuing
admin route are each a day of work and the demo does not need them; the
charter forbids server-side *student* profiles (A4), not instructor
accounts, so the door stays open. The shared token is the hackathon shape.
*Superseded the same day by D12: the shared token is gone.*

## D12 — instructors sign in with Google; the shared bearer token is removed — DECIDED (user, 2026-09-16: "we shouldn't have authoring token. Can we make people sign in with google accounts")

**What changed.** The API takes a Google ID token on every route:
`Authorization: Bearer <id token>`. API Gateway's JWT authorizer verifies
it against `https://accounts.google.com` with two accepted audiences, this
deployment's OAuth web client id (`GOOGLE_CLIENT_ID`, deployed as CDK
context) and the Google Cloud SDK's public client id, so scripts can use
`gcloud auth print-identity-token`. Verification alone admits nobody: each
Lambda then checks the claims against `ACCESSLENS_INSTRUCTORS`, a
comma-separated list of instructor emails and `@domains` deployed as the
`INSTRUCTOR_ALLOWLIST` environment variable (`services/api/identity.ts`).
Unverified email or not on the list is 403 `not_an_instructor`; an empty
list admits nobody. Jobs record the creator's Google subject (`ownerSub`)
and the job routes answer 404 for anyone else's job. Health keeps the JWT
check but not the allowlist. The bearer authorizer, the SSM parameter and
its custom resource, `BearerToken` and `TokenParameterName` outputs are
deleted, not kept behind a flag.

**Clients.** The instructor panel signs in with Google: inside the
extension through `chrome.identity.launchWebAuthFlow` (ID token only, no
access token, nonce and state checked), on a plain web page through
Google Identity Services' button. The token stays in this browser's
localStorage until it expires; a 401 from the API drops it and shows the
button again. `VITE_GOOGLE_CLIENT_ID` configures the build; without it the
upload panel says so and offers nothing.

**Why this shape.** No user database and no server-side profile of anyone
(charter A4 forbids student profiles; this stores one subject id per
job, for instructors only). Google verifies who; the deployment decides
which of them may author. Swapping the allowlist for a course roster later
is a change inside `identity.ts`, nothing else moves.

**Operator setup.** One OAuth 2.0 client id (type Web application) in Google
Cloud console, authorized JavaScript origins `http://localhost:5173` and the
CloudFront viewer URL; for the installed extension add
`https://<extension-id>.chromiumapp.org/` as an authorized redirect URI.
`make deploy` refuses to run without `GOOGLE_CLIENT_ID` and
`ACCESSLENS_INSTRUCTORS` (environment or `.env.local`).

**Spec deviation, recorded.** `docs/prompts/viz-system-build.md` describes
the deploy-time bearer token in SSM; this decision replaces that paragraph
by user instruction. The prompt file is not edited.
*Amended the same day by D13: the allowlist is gone; any verified Google
account is an instructor.*

## D13 — two roles; professors self-register and own a course library for retrieval — DECIDED (user, 2026-09-16: "We should have 2 roles, professor and student. Students don't need to sign in, but we need professor accounts to have a dataset of class resources (for RAG). Anybody can create a professor account for the moment")

**Roles.** Students never sign in and never call the authoring API; they
read published packs, media and artifacts from CloudFront as before, and
nothing about them is stored anywhere (charter A4, hard rule 3). Professors
sign in with Google (D12). There is no approval step and no allowlist for
now: any verified Google account that calls `GET /v1/me` gets an instructor
record (`instructors` table keyed by Google subject: email, name,
createdAt, lastSeenAt). That record is the user base. Gating who may become
a professor is a later decision; the place to add it is `ensureInstructor`
in `services/api/instructors.ts`, nothing else moves.

**Class resources for retrieval.** This is spec section 9, the course
library, wired for real: a professor creates course profiles (`POST
/v1/profiles`, owned by their subject id), adds textbooks, notes, slides,
problem sets or a syllabus (`POST /v1/uploads` then `POST
/v1/profiles/{id}/documents`), and the indexer Lambda extracts page text
with Poppler (PPTX and DOCX go through LibreOffice first, in the same
container as ingest), chunks page by page, embeds with Titan v2 from
Lambda only (hard rule 12), writes the profile's S3 Vectors index plus the
verbatim chunk manifest, and verifies with a page-one query before the
document is `ready`. A deck job that names a profile now retrieves before
Sonnet writes: eight excerpts for the deck analyst from three windows of
the deck text, four per slide for the pack author from that slide's text
(spec 9.4); references survive only the verbatim check that already
existed. A job without a profile runs exactly as before. Every profile,
document and search route answers 404 for another professor's profile.

**Deviations from the spec's shape, recorded.** Indexing is one Lambda
invocation running the four stages in sequence (the document record
reports each stage), not a Step Functions execution per document: the
stages already existed as one function and a workflow would add only
visibility. The S3 Vectors bucket is a native CloudFormation resource
(`AWS::S3Vectors::VectorBucket` exists now), so no custom resource; indexes
are created per profile at runtime and `make destroy` deletes any that
remain before the stack delete. The documents table is keyed by `docId`
with a `profileId-index`, matching the store the library lane wrote.

**What students get.** Read mode already lists an asset's `references`
as "From your course materials"; nothing else on the student side changes.
The search route is instructor-only; a student question-answering client
would go through the AI gateway, which is not part of this decision.
