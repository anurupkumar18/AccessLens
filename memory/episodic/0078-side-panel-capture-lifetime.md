# Side-panel capture lifetime

Date: 2026-09-17
Owner: Codex
Scope: Part 2 instructor capture / local rehearsal

## Decision

Starting `getDisplayMedia()` from the extension side panel is not a stable
capture surface: choosing another browser tab can close or unload the side
panel, whose cleanup correctly releases the local capture. The side panel now
offers a full-tab link instead of starting capture itself. The full-tab URL is
marked with `surface=full`, and the full-tab instructor view retains the normal
Start flow.

## Contract and data implications

No capture, event, transport, or media contract changed. The browser chooser
still requires an explicit user click, and raw media remains local to the
capture document.

## Evidence and follow-up

`InstructorPanel.test.tsx` and `App.test.tsx` pass after the UI change. A real
Chrome side-panel/full-tab capture matrix remains required; the new path is a
workaround for the document lifetime boundary, not proof of physical-browser
capture behavior.

The first local rehearsal then exposed a separate recognition issue: the
uploaded image fingerprint did not use the capture pipeline's 16:9 letterbox
crop. `localPack.ts` now fingerprints the same cropped geometry, so an
image-only tab and its local pack use identical preprocessing. Reload the local
slide pack after this change before starting a new session.

The student-tab follow-up exposed a second local-demo boundary: a `local-*`
pack ID sent through the semantic session event was not fetchable from `/packs`.
Local packs now persist the reviewed pack JSON and rendered image data URL in
same-origin browser storage, and every tab restores the latest local pack at
startup. This remains device-local and does not change the production upload
or published-pack path.

The student shell also now selects a local pack only when its pack ID/version
matches the incoming session event, and skips the remote pack fetch for that
case. Local preview recognition uses the reviewed demo tolerance of 26 bits
instead of the earlier 12-bit limit.

Product direction was clarified on 2026-09-17: spatial AR is automatic for
uploaded slides and does not wait for instructor approval in this MVP. The
automatic local path uses neutral spatial area labels rather than claiming
semantic facts the system has not established. Cursor-driven focus still
requires a window or screen share because browser tab capture omits the cursor.

## Goal

Keep browser capture alive while the instructor switches from the AccessLens
side panel to the slide tab, and make local slide AR testable in a second tab.

## Changed files

- `apps/extension/src/instructor/InstructorPanel.tsx`
- `apps/extension/src/shell/App.tsx`
- `apps/extension/src/shared/localPack.ts`

## Validation evidence

Focused instructor, shell, media, AR, and student tests pass. Production build
and relay validation pass. Physical Chrome capture remains open follow-up QA.

## Blocker

No implementation blocker. Physical Chrome capture and cursor-following smoke
testing remain open.

## Owner

Codex / Part 2 capture and Part 3 local AR.

## Next action

Run the full-tab instructor flow, share a window or screen, and verify the
student AR region changes on a real browser.
