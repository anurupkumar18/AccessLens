# Reviewed focus pointer

## Goal

Finish the existing instructor “Point students at a region” control as a
privacy-safe semantic pointer rather than a UI that only changed the selected
region.

## Changed files

- `captureController.ts` derives a normalized center point from the selected
  reviewed region and includes it in the existing optional `region.changed`
  pointer field.
- Student live state retains that validated semantic point.
- Focus mode shows a visible marker only when the event carries one; the region
  outline and text fallback remain unchanged for older/no-pointer events.

## Validation evidence

Focused controller, instructor panel, student-state, and Focus tests passed: 48
tests. The full extension typecheck/test/build passed with 294 tests before the
repository-wide check.

## Data and scope boundary

The point is calculated entirely from checked-in reviewed Access Pack bounds. It
is not a captured mouse/cursor coordinate, raw screen content, identity,
preference, behavior signal, or retained telemetry. The existing event contract
was used unchanged.

## Blocker

No code blocker. Visual rendering in a clean unpacked extension and the
multi-device relay route require an operator and are not represented by unit
tests.

## Owner

Codex, at Anurup Kumar's direction (AL-041 feature-branch prototype).

## Next action

Use a clean unpacked extension to verify the marker on Focus and the unchanged
equivalent Read/Hear/AR routes, then perform the device/relay bench separately.
