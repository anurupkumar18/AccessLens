# Local slide preview for AR testing

## Goal

Let localhost users test spatial AR without configuring Google sign-in or the
remote authoring API.

## Changed files

- Added `apps/extension/src/shared/localPack.ts` to turn a local PNG/JPEG into
  a device-local Access Pack and matching fingerprint.
- Added local media lookup in `apps/extension/src/shared/packMedia.ts`.
- Added a dev-only upload surface in `apps/extension/src/instructor/AuthoringPanel.tsx`.
- Wired the local pack through `apps/extension/src/shell/App.tsx`.

## Boundary

This is a development preview only. It accepts slide images, creates one
whole-slide placeholder region, stores the object URL in the current browser,
and never bypasses production Google authorization or sends data to AWS. Full
PPTX/PDF authoring still uses the authenticated pipeline and human review.

## Validation

Focused authoring, media, AR, and student tests passed: 34 tests. Root typecheck
still reports the pre-existing missing Bedrock Agent Runtime and SageMaker SDK
modules.

## Validation evidence

Focused authoring, media, AR, and student tests passed: 34 tests. Root
typecheck still reports the pre-existing missing Bedrock Agent Runtime and
SageMaker SDK modules.

## Blocker

No implementation blocker. Local preview accepts PNG/JPEG images only; full
PPTX/PDF authoring remains on the authenticated pipeline.

## Owner

Codex / Part 3 local rehearsal.

## Next action

Use the local preview with a slide image, then verify the student tab and AR
route in a real browser.
