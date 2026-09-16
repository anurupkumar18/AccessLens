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
ownership row. Relay thread T-29 records that Part 6 created `infra/` in
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
deferred; their relay threads (T-26, T-27, T-28) stay OPEN with Part 6 named,
and `docs/VIZ_HANDOFF.md` lists them as the next action. Every capability they
would have used is reachable over HTTPS with the bearer token, which is the
property the spec's API-first rule actually asks for.

**Date.** 2026-09-15.
