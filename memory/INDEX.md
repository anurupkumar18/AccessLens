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

- `docs/VISION.md`
- `docs/PROJECT_CHARTER.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PARALLEL_WORKSTREAMS.md`
- `docs/SYSTEM_DESIGN.md`
- `docs/ACCESSLENS_PROPOSAL.md`
- `docs/TEAM_PRODUCT_DIRECTION.md`

Part 1 (foundation and contracts) is owned by Anurup Kumar; Part 5 (reviewed
content, camera adapter, and demo QA) by Kunj Rathod. Part 5's content and
simulator block is merged: `packages/access-packs/bio-cell-demo/` holds the
reviewed five-slide deck, an original AR cell model with stable node names, six
ordered event scenarios, and ten rejection fixtures, all validated by
`make pack-check`. Parts 2, 3, and 4 can test against it today without the
extension shell or AWS. The camera adapter remains unstarted Phase 6 scope.

Part 1's foundation (`df80b5d`) is merged into that branch. Conformance between
the pack and `packages/contracts/` is tracked by `make pack-check` and reported
in `docs/PART5_CONTRACT_CONFORMANCE.md`: thirteen known gaps, two of which are
contract bugs — `assetId` is required on every event, which makes the
charter-required `source.unmatched` unrepresentable, and
`live-event.schema.json` rejects `regionId` and `pointer` that the Zod schema
accepts, so it fails Part 1's own fixture.

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

- `episodic/0038-bio-cell-demo-access-pack.md`
