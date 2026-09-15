# Part 1 handoff: foundation and contracts

Phase 1, A1/A2 is implemented in the extension shell and `packages/contracts/`.
The built `dist/` directory can be loaded as an unpacked Chrome extension. The
UI has Instructor and Student routes under `apps/extension/src/shell/`
(`App`, `RoleNav`, `ErrorBoundary`), keyboard-focusable role navigation, and a
fixture event sent through `InMemorySessionClient` so the Student view follows
the Instructor view without network access. An unexpected render error is
caught by `ErrorBoundary` and shown as an accessible `role="alert"` message
instead of blanking the panel.

## Loading the unpacked extension in Chrome

1. `npm run build` (produces/refreshes `dist/`).
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repository's `dist/` directory.
5. Click the AccessLens action icon to open the side panel; switch between
   Instructor and Student with the role navigation.

This is a manual step for a human with Chrome -- no tool in this build
environment can drive a real Chrome browser or `chrome://extensions`. What
*was* verified here is that the built `dist/` assets serve and run correctly
under a plain static server (see Verification below); an actual load-unpacked
pass is still outstanding.

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

## Role capability (session-token) contract

`RoleCapabilitySchema` (`apps/extension/src/shared/contracts.ts`, mirrored in
`packages/contracts/role-capability.schema.json`) is the "session-token"
schema `IMPLEMENTATION_PLAN.md`'s A2 names and that was missing from the
first Part 1 commit. It carries `sessionId`, `role`
(`instructor`/`student`), `issuedAt`/`expiresAt`, and an opaque signed
`token`. Part 1 owns the shape; Part 4 owns actually signing the token (AWS
KMS) when it replaces the mock. `.strict()` -- it cannot carry identity,
diagnosis, or behavioral fields.

## SessionClient contract

`SessionClient` now matches the interface frozen in
`PARALLEL_WORKSTREAMS.md`'s 45-minute contract freeze: `create`, `join`,
`send`, `subscribe`, `close`. `InMemorySessionClient.create`/`.join` issue a
mock `RoleCapability`; `close()` invalidates the client so a further `send`
throws, matching `SYSTEM_DESIGN.md`'s "Closing the session invalidates the
capability and stops delivery." Part 4 replaces `InMemorySessionClient`
behind this same interface without Parts 2/3 changing their imports.
`SessionMessageSchema` gained matching `create`/`close` message kinds
alongside the existing `join`/`event` kinds.

## Frozen environment variable names

`.env.example` at the repo root freezes the two names the contract-freeze
checklist calls for: `VITE_ACCESSLENS_WS_URL` (API Gateway WebSocket
endpoint) and `VITE_ACCESSLENS_ASSET_BASE_URL` (S3/CloudFront asset base).
Part 4 defines and deploys the real values; nothing in Parts 1-3 requires
them to be set for local, network-free development.

## Student preferences

`apps/extension/src/shared/preferences.ts` adds a local-only
`StudentPreferencesSchema` (mode, text scale, reduced motion, captions) and a
`chrome.storage.local` wrapper with an in-memory fallback for tests. It is
`.strict()` -- identity, diagnosis, grade, and attention-style fields fail to
parse -- and it is never passed to `SessionClient` or any `LiveEvent`. The
Student view now has a working "Reduce motion" checkbox wired to this module,
so the "preferences never leave local storage" claim is exercised by the
running shell, not only by a unit test.

## Build configuration

`npm run typecheck` (`tsc --noEmit`) is now part of `npm run check`;
previously the strict `tsconfig.json` was never actually run, so type errors
were invisible. Added `@types/react`, `@types/react-dom`, and `@types/node`,
plus `apps/extension/src/vite-env.d.ts` for Vite's asset/env ambient types
(this is what makes the CSS side-effect import type-check).

## What is still out of scope for Part 1

Capture, AWS, camera, computer vision, and the AR renderer remain outside
this slice. Part 2 should emit the existing `LiveEvent` through
`SessionClient`; Part 3 should subscribe to it, add renderers/AR, and can now
read/write student mode through `preferences.ts` without importing AWS. Part 4
can replace `InMemorySessionClient` behind the `SessionClient` interface,
issuing real signed `RoleCapability` tokens instead of the mock ones. Part 5
owns the reviewed biology pack and broader demo QA.

## Verification

`npx vitest run`, `npm run check` (typecheck + test + build), and `make
check` all pass (see `memory/episodic/0038-part1-hardening.md` and
`memory/episodic/0039-part1-contract-gaps.md` for exact counts). The rebuilt
`dist/` was manually exercised through a static `vite preview` server: role
switch, fixture-event send, student-side following, and the reduced-motion
preference toggle all work with no console errors. A real `chrome://extensions`
-> Load unpacked pass by a human with Chrome is still outstanding; no
sandboxed tool here can drive an actual Chrome instance.
