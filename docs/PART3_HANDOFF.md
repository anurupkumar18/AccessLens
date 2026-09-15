# Part 3 handoff: Student experience and AR

Part 3 implements tasks A9–A13 on branch `workstream/3-student-ar`.

## Implemented behavior

- The Student extension accepts a session code through the frozen `SessionClient`
  interface and presents live, paused, stale, unmatched, ended, and incompatible
  states.
- Events are sequence-checked client-side; duplicate or older events cannot replace
  newer state.
- A pack ID or version mismatch stops rendering instead of silently showing the
  wrong lesson.
- Focus, structured-text, requested-audio, and AR modes read the same reviewed
  `AccessPack` and current event.
- The AR renderer builds a local procedural cell with membrane, nucleus, and
  mitochondria. A `region.changed` event focuses its corresponding semantic
  hotspot.
- The renderer offers a WebXR `immersive-ar` session where the device supports it
  and always retains the extension-owned spatial viewport.
- When WebGL is unavailable, a visible status and semantic hotspot controls preserve
  access to the same labels and relationships.
- Mode, reduced-motion, and text-scale choices stay in the existing local-only
  preference store.
- Three.js is loaded as a separate lazy chunk so non-AR modes do not pay the full AR
  startup cost.

## Implementation discrepancy resolved

The planning documents named React Three Fiber before dependencies or renderer code
existed. The licensed reference selected during implementation, UnseenLab, uses
direct Three.js and demonstrates the lifecycle behavior this extension needs.
AccessLens therefore uses direct Three.js plus WebXR for the MVP. This keeps one
renderer lifecycle, supports deterministic event-driven highlights, and avoids a
second abstraction during the 48-hour build. `SYSTEM_DESIGN.md` and
`ACCESSLENS_PROPOSAL.md` now record that observable choice.

## Reference repository review

- **UnseenLab** is Apache-2.0. Its explicit cleanup, reduced-motion, fallback, and
  semantic-equivalent patterns were adapted. Attribution is in
  [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
- **ARFED-V1** shows a useful lightweight `<model-viewer>` approach, but its
  repository has no license. No code or remote model asset was copied.
- **EducationAR** is a Unity/AR Foundation project and has no repository-level
  license. It is also not directly compatible with a Manifest V3 web extension, so
  no code or assets were copied.

## Test and run

```powershell
npm.cmd ci
npm.cmd run check
```

Then load `dist/` through `chrome://extensions` → **Developer mode** → **Load
unpacked**. Send the fixture event from Instructor mode, switch to Student mode,
and select **AR**. The synchronized concept should read **Mitochondrion**. On a
compatible secure-context device, **View in my space** starts immersive AR.

## Validation evidence

- `npm.cmd run typecheck` passes.
- Vitest passes 111/111 tests across 14 files.
- Vite production build passes and splits the AR renderer into its own chunk.
- The tests cover event ordering, pack-version mismatch, stale-state preservation,
  AR hotspot mapping, WebGL fallback, semantic controls, mode switching, keyboard
  tab movement, and an axe-core scan of the AR fallback surface.

## Known limits and integration needs

- Immersive WebXR still requires a compatible device/browser and a human device
  smoke test; automated tests validate the deterministic fallback path.
- Part 5 must review the checked-in demo descriptions before presentation.
- The current frozen `AccessPack` schema does not yet include `arScene`. Part 3 uses
  a local `bio-cell-demo` mapping and the already-supported `LiveEvent.arState`.
  Parts 1 and 5 should jointly extend the shared schema before adding external GLB
  packs; do not create a duplicate contract in Part 3.
- The procedural model avoids an unlicensed external asset. Part 5 can replace it
  with a reviewed licensed `.glb` after the shared `arScene` schema is approved.
- Vite reports that the lazy Three.js chunk is larger than 500 kB minified; it is
  isolated from the main extension chunk and can be reduced after the demo path is
  stable.
