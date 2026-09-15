# AccessLens agent guide

## Read in this order

1. `memory/INDEX.md`
2. `docs/VISION.md`
3. `docs/PROJECT_CHARTER.md`
4. `docs/IMPLEMENTATION_PLAN.md`
5. `docs/SYSTEM_DESIGN.md` and the affected contract
6. The latest relevant record in `memory/episodic/`

Older semantic and episodic records describe the superseded Evidence Engine coding
prototype. Preserve them as history, but do not use them as current requirements.

## Source of truth

- `docs/PROJECT_CHARTER.md` is the operational safety and data contract.
- `docs/TEAM_PRODUCT_DIRECTION.md` is the current human product decision.
- `docs/IMPLEMENTATION_PLAN.md` defines phases and task IDs.
- `docs/SYSTEM_DESIGN.md` defines extension, event, and AWS boundaries.
- `docs/ACCESSLENS_PROPOSAL.md` contains research, pitch, and scope.
- Code proves only current behavior; it does not override these documents.

When documents conflict, name the discrepancy and stop. Record the intended
observable behavior and what it supersedes before implementation.

## Product invariants

- Capture requires an explicit user action and browser permission.
- Raw screen, audio, and camera media stays on the source device by default.
- Only allowlisted semantic live events reach the backend.
- Access Packs require instructor review before publication.
- Accessibility preferences remain student-local and do not become diagnoses.
- No grading, mastery, attention, emotion, gaze, accent, or disability inference.
- No Canvas scraping or production Canvas data without institutional approval.
- AR is a required student-extension renderer in the hackathon MVP, with an
  equivalent non-immersive route to the same instructional meaning.
- Camera mode is optional stretch scope for physical content; students do not each
  need cameras.
- Unknown content produces an unmatched state, never an invented description.
- Equivalent accessible paths must preserve the same instructional meaning.

See `docs/PROJECT_CHARTER.md` for the authoritative A1–A11 wording.

## Working agreement

- Scope each change to one vertical outcome and cite a phase/task ID from
  `docs/IMPLEMENTATION_PLAN.md`.
- State acceptance criteria, affected contract, and data implications before edits.
- Keep capture, recognition, transport, rendering, and camera adapters separate.
- Use checked-in synthetic or public demo assets until institutional approval.
- Extend contract, privacy, permission, and accessibility tests with each surface.
- Add a compact episodic handoff when a task changes contributor context.
- Update semantic or long-term memory only through a reviewed PR.
- Run the narrowest checks and `make check` before merge.
- Report changed files, checks, evidence, risks, and next action.
