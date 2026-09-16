# Shared memory index

## Current state

On September 15, 2026, the product owner explicitly selected **AccessLens** as the
main hackathon direction and superseded the Evidence Engine coding-practice product.
AccessLens is an extension-first accessibility system: an instructor explicitly
shares a tab, window, or screen; local matching emits temporary semantic events;
student extensions automatically render the same live moment through Focus,
structured-text, caption, audio, or spatial modes.

AR is a required student-extension renderer in the hackathon MVP. Camera input is
the advanced source adapter for labs and other physical content that cannot be
screen-shared; every student does not need a camera. The MVP uses one checked-in
biology deck, one instructor extension, two student extensions, a synchronized AR
cell model, and an AWS WebSocket relay. Production Canvas integration remains
deferred and gated.

Current sources of truth:

- `docs/CONTEXT_RELAY.md` — live state, open threads, and the relay log
- `docs/VISION.md`
- `docs/PROJECT_CHARTER.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PARALLEL_WORKSTREAMS.md`
- `docs/SYSTEM_DESIGN.md`
- `docs/ACCESSLENS_PROPOSAL.md`
- `docs/TEAM_PRODUCT_DIRECTION.md`

Part 1 (foundation and contracts) is owned by Anurup Kumar, Part 2 (instructor
capture) by Jacob, and Part 5 (content, camera, and demo QA) by Kunj Rathod.
Parts 3 and 4 have no owner. Part 5's pack merged as `a881f11`:
`packages/access-packs/bio-cell-demo/` holds the reviewed five-slide deck, an
original AR cell model, six ordered event scenarios, and ten rejection fixtures,
all validated by `make pack-check`.

Both contract bugs Part 5 reported are fixed: `c3ddc27` made `LiveEventSchema` a
per-type discriminated union, so `source.unmatched` is structurally unable to
name an asset, and the JSON Schema now mirrors it. Ten conformance gaps remain,
all requests to widen the contract, reported in
`docs/PART5_CONTRACT_CONFORMANCE.md`. The most serious is that
`access-pack.schema.json` forbids `arScene`, so the pack cannot carry the AR
scene charter A10 requires.

`docs/CONTEXT_RELAY.md` is the live state of the project and the register of
every open thread; append to it at the end of any session that changes that
state.

The previous application, API, fixtures, plugin, and active coding-product guides
were removed. Git history is the recovery path. Existing semantic records and
episodic records 0001–0035 are historical Evidence Engine context, not AccessLens
requirements.

## Historical semantic records

- `semantic/architecture.md` — superseded coding-engine layer map
- `semantic/contracts.md` — superseded FastAPI contract

Do not update or reinterpret these as AccessLens contracts outside a reviewed PR.
The active AccessLens contracts live in `docs/SYSTEM_DESIGN.md`.

## Long-term records

- `long-term/public-data.md` — historical public-data rule; its cautious treatment
  of private inputs remains useful, but the current data contract is the charter.

## Current handoff

Parallel workstreams number their own episodic records (T-17), so there is no
longer one single "latest" file. Each part's newest record:

- `episodic/0063-local-camera-consent-lifecycle.md` (Part 1/camera foundation: explicit local start/stop exists; recognition and physical QA remain review-gated)
- `episodic/0062-disabled-course-material-provider.md` (Part 1/course boundary: strict no-network Canvas/RAG placeholder is review-ready; no provider is enabled)
- `episodic/0061-review-keyboard-format-navigation.md` (Part 1/Review accessibility: keyboard-equivalent format tabs are review-ready; physical QA remains open)
- `episodic/0060-explicit-local-review-progress.md` (Part 1/self-paced Review: explicit private concept markers are local-only and non-assessment)
- `episodic/0059-disabled-bedrock-gateway.md` (Part 1/model boundary: strict no-network Bedrock placeholder is review-ready; no provider is enabled)
- `episodic/0058-reviewed-focus-pointer.md` (Part 1/instructor-to-student focus: reviewed region center now travels through the existing semantic pointer field and is QA-ready)
- `episodic/0057-self-paced-review-route.md` (Part 1/student route: reviewed-pack-only, non-live Review surface and local bookmarks are QA-ready)
- `episodic/0055-capture-user-activation-order.md` (Part 2/QA: browser capture now begins before awaited session creation; Windows hardware proof remains open)
- `episodic/0054-local-reading-settings.md` (Part 1/unowned student surface: local-only reading controls and requested-audio speed are ready for QA; real-browser accessibility evidence remains open)
- `episodic/0053-fail-closed-invalid-relay-event.md` (Part 1: malformed inbound relay events now fail closed in the student UI; deployment and real-device proof remain open)
- `episodic/0051-demo-proof-sprint-operator-evidence.md` (cross-cutting: privacy-safe operator packet and a 30-event relay quality bench; deployment and human-only proof remain explicitly open)
- `episodic/0050-stop-versus-end-session-lifecycle.md` (Part 1/cross-cutting: `capture.stopped` separates stopped sharing from terminal session end; locally verified and awaiting contract review/deploy)
- `episodic/0049-agent-first-delivery-system.md` (Part 1: repository-native tickets, claims, immutable updates, generated agent context, and validation)
- `episodic/0048-remove-t29-implementation-block.md` (Part 1: T-29 becomes a non-blocking agenda for tomorrow's in-person meeting)
- `episodic/0047-anurup-alignment-response.md` (Part 1: Anurup's signed T-29 response; follow-up decision removed the implementation block)
- `episodic/0046-team-alignment-check.md` (cross-cutting: committed the hidden critique/revision docs, opened T-29 blocking further work until every contributor responds)
- `episodic/0045-fix-false-stale-connection.md` (cross-cutting: fixed a false "Connection interrupted" alarm the team hit live-testing)
- `episodic/0044-wire-live-relay-and-launch-test.md` (cross-cutting: wired the deployed relay into the shell, launch-tested the full stack)
- `episodic/0043-deployment-readiness.md` (Part 4 recon: AWS account is deployable, CDK not bootstrapped)
- `episodic/0042-merge-parts-1-2-3-5.md` (cross-cutting: merged PRs #6/#7/#8 onto the integration branch)
- `episodic/0041-part2-instructor-capture.md` (Part 2: instructor capture)
- `episodic/0041-context-relay.md` (cross-cutting: relay log and open threads)
- `episodic/0040-part3-student-ar.md` (Part 3: student experience and AR, merged into Part 2's branch)
- `episodic/0040-bio-cell-demo-access-pack.md` (Part 5: reviewed pack)
- `episodic/0039-part1-contract-gaps.md` (Part 1: foundation and contracts)
