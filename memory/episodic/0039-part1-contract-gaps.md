# Part 1 contract gaps closed: role capability, SessionClient, env vars

## Goal

A verification-before-completion pass on the 0038 hardening found that Part 1
was not actually complete: its own literal Build/contract-freeze list in
`docs/PARALLEL_WORKSTREAMS.md` had unmet items that 0038 did not touch. Close
those gaps.

## Discrepancies found and resolution

Re-reading `docs/PARALLEL_WORKSTREAMS.md` and `docs/IMPLEMENTATION_PLAN.md`
line by line against the actual code turned up three real gaps, not just
polish:

1. `PARALLEL_WORKSTREAMS.md:60-61` requires Zod/JSON Schema validation for
   "Access Packs, live events, role capabilities, and session messages." Role
   capabilities had no schema anywhere in the tree. `IMPLEMENTATION_PLAN.md`'s
   A2 independently names a "session-token" schema. Resolution: added
   `RoleCapabilitySchema` (`apps/extension/src/shared/contracts.ts`) mirrored
   in `packages/contracts/role-capability.schema.json`, both `.strict()` and
   ajv/Zod contract-tested.
2. `PARALLEL_WORKSTREAMS.md:30` freezes "a `SessionClient` interface with
   `create`, `join`, `send`, `subscribe`, and `close` operations." The
   interface only had `send`/`subscribe`. Resolution: `SessionClient` and
   `InMemorySessionClient` now implement all five; `close()` invalidates the
   client (`send` after `close` throws), matching `SYSTEM_DESIGN.md`'s
   documented closing behavior. `SessionMessageSchema` gained matching
   `create`/`close` kinds.
3. `PARALLEL_WORKSTREAMS.md:33` freezes "environment-variable names for the
   WebSocket endpoint and asset base URL." Nothing was defined. Resolution:
   `.env.example` at the repo root names `VITE_ACCESSLENS_WS_URL` and
   `VITE_ACCESSLENS_ASSET_BASE_URL`.

Two lower-severity gaps were also closed:

4. The local-only `StudentPreferences` mechanism (added in 0038) was tested
   but never wired into the actual shell, so "preferences never leave local
   storage" was only proven in isolation. The Student view now has a working
   "Reduce motion" checkbox bound to `preferences.ts`.
5. `npx tsc --noEmit` had 83 pre-existing errors (missing `@types/react`,
   `@types/react-dom`, `@types/node`, and no ambient types for the CSS
   side-effect import) and was never run by any script, so type errors were
   invisible. Added the three `@types/*` packages, `apps/extension/src/
   vite-env.d.ts`, and a `typecheck` script now run first in `npm run check`.

Also added concrete `chrome://extensions` -> Load unpacked steps to
`docs/PART1_HANDOFF.md`, since "provide scripts to ... load the unpacked
extension" had previously been satisfied only with prose.

## Changed files

- `apps/extension/src/shared/contracts.ts` -- `RoleCapabilitySchema`,
  expanded `SessionClient`/`InMemorySessionClient` (create/join/close),
  expanded `SessionMessageSchema`.
- `apps/extension/src/shared/capabilities.test.ts` (new),
  `apps/extension/src/shared/sessionClient.test.ts` (new).
- `packages/contracts/role-capability.schema.json` (new) and
  `packages/contracts/role-capability.schema.test.ts` (new).
- `.env.example` (new, repo root).
- `apps/extension/src/shell/App.tsx` -- reduced-motion checkbox wired to
  `preferences.ts`; `apps/extension/src/shell/App.test.tsx` -- persistence
  test.
- `apps/extension/src/vite-env.d.ts` (new).
- `package.json` -- `typecheck` script, `@types/react`, `@types/react-dom`,
  `@types/node` dev dependencies; `check` now runs typecheck first.
- `docs/PART1_HANDOFF.md` -- rewritten to cover all of the above plus
  concrete load-unpacked steps.

## Validation evidence

- `npx vitest run` -- 98/98 passing (10 files).
- `npm run check` (typecheck + test + build) -- passing; `npx tsc --noEmit`
  alone is clean (0 errors, down from 83).
- `make check` -- passing.
- Manually re-verified the rebuilt `dist/` in the sandboxed browser pane: the
  Reduce-motion checkbox toggles, persists within the page session, and
  correctly resets on a full reload (expected -- the in-memory fallback is
  page-scoped outside a real extension context; only `chrome.storage.local`
  inside an actual unpacked extension persists across reloads). No console
  errors.

## Blocker

None. A real `chrome://extensions` Load-unpacked pass by a human with Chrome
is still the one thing this sandbox cannot do.

## Owner

AccessLens team (Part 1: Anurup Kumar).

## Next action

Part 4 can now build its real `SessionClient` directly against the frozen
`create`/`join`/`send`/`subscribe`/`close` interface and issue real signed
`RoleCapability` tokens matching the frozen schema instead of discovering the
shape mid-integration. Parts 2-5 owner names in `PARALLEL_WORKSTREAMS.md` are
still blank; that assignment is unchanged by this work.
