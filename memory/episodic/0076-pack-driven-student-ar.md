# Pack-driven student AR

## Goal

Make the student AR renderer follow whichever reviewed slide the instructor
shares, instead of always showing the biology cell scene.

## Changed files

- Added `apps/extension/src/ar/PackArView.tsx`, a pack-driven spatial renderer.
- Added `apps/extension/src/ar/PackArView.test.tsx`.
- Updated `apps/extension/src/student/StudentExperience.tsx` to pass the current
  asset and to offer AR for assets with reviewed regions.
- Updated student AR expectations and `docs/CONTEXT_RELAY.md`.

## Behavior and boundaries

Recognized assets use reviewed regions and authored `arScene` hotspot labels
when present. Assets without a 3D model use a deterministic spatial-slide
fallback from those same reviewed regions. Unknown content remains unmatched;
the renderer does not invent labels or descriptions. WebXR remains optional,
with keyboard/pointer controls as the equivalent route.

## Validation

Focused AR/student Vitest suite: 26 passed. Production Vite build passed.
Relay structure check passed. Repository typecheck remains blocked by the
pre-existing missing `@aws-sdk/client-bedrock-agent-runtime` and
`@aws-sdk/client-sagemaker-runtime` dependencies in `services/ai-gateway`.

## Next action

Smoke-test `View in my space` on a compatible WebXR device and verify a
published non-biology pack with multiple regions in the browser.

## Validation evidence

Focused AR/student Vitest suite: 26 passed. Production Vite build passed.
Relay structure check passed. Repository typecheck remains blocked by the
pre-existing missing AWS SDK modules named above.

## Blocker

No implementation blocker. Physical WebXR and published non-biology pack smoke
testing remain open follow-up work.

## Owner

Codex / Part 3 student AR.
