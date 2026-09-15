# Part 1 handoff: foundation and contracts

Phase 1, A1/A2 is implemented in the extension shell and `packages/contracts/`.
The built `dist/` directory can be loaded as an unpacked Chrome extension. The
UI has Instructor and Student routes under `apps/extension/src/shell/`
(`App`, `RoleNav`, `ErrorBoundary`), keyboard-focusable role navigation, and a
fixture event sent through `InMemorySessionClient` so the Student view follows
the Instructor view without network access. An unexpected render error is
caught by `ErrorBoundary` and shown as an accessible `role="alert"` message
instead of blanking the panel.

## LiveEvent contract matrix

`LiveEventSchema` (`apps/extension/src/shared/contracts.ts`) is a Zod
discriminated union on `type`. This was a resolved discrepancy, not an
original design choice -- see `memory/episodic/0038-part1-hardening.md` for
why the flat schema was unsafe. The matrix, mirrored in
`packages/contracts/live-event.schema.json` and contract-tested with `ajv`:

| type | assetId | regionId | pointer | arState |
| --- | --- | --- | --- | --- |
| `asset.changed` | required | forbidden | forbidden | forbidden |
| `region.changed` | required | required | optional | optional |
| `session.started`, `caption.appended`, `capture.paused`, `capture.resumed`, `session.ended`, `source.unmatched` | forbidden | forbidden | forbidden | forbidden |

`source.unmatched` cannot carry an `assetId` or `regionId` -- the schema
enforces "never an invented description" structurally, not by convention.
Every event type also rejects any field outside this matrix, including
raw-media, identity, diagnosis, grading, or attention-style fields (see the
denylist test in `contracts.test.ts`).

`AccessPackSchema` and `packages/contracts/access-pack.schema.json` now both
validate full asset/region shape (bounds, descriptions); the JSON Schema
previously only checked that `assets` was a non-empty array.

## Student preferences

`apps/extension/src/shared/preferences.ts` adds a local-only
`StudentPreferencesSchema` (mode, text scale, reduced motion, captions) and a
`chrome.storage.local` wrapper with an in-memory fallback for tests. It is
`.strict()` -- identity, diagnosis, grade, and attention-style fields fail to
parse -- and it is never passed to `SessionClient` or any `LiveEvent`.

## What is still out of scope for Part 1

Capture, AWS, camera, computer vision, and the AR renderer remain outside
this slice. Part 2 should emit the existing `LiveEvent` through
`SessionClient`; Part 3 should subscribe to it, add renderers/AR, and can now
read/write student mode through `preferences.ts` without importing AWS. Part 4
can replace `InMemorySessionClient` behind the `SessionClient` interface. Part
5 owns the reviewed biology pack and broader demo QA.

## Verification

`npx vitest run`, `npm run check`, and `make check` all pass (see
`memory/episodic/0038-part1-hardening.md` for exact counts). The rebuilt
`dist/` was manually exercised through a static `vite preview` server: role
switch, fixture-event send, and student-side following all work with no
console errors. A real `chrome://extensions` -> Load unpacked pass by a human
with Chrome is still outstanding; no sandboxed tool here can drive an actual
Chrome instance.
