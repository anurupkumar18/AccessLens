# AccessLens agent guide

## STOP — mandatory team alignment check (as of 2026-09-16)

Before any further implementation work in this repository, read
[`docs/TEAM_ALIGNMENT_CHECK.md`](docs/TEAM_ALIGNMENT_CHECK.md) in full and add
a signed response in its Responses section. This is not optional and does
not expire until every contributor listed there has responded. It contains a
harsh, honest scorecard of this project against the hackathon's own judging
criteria, external research that changes how the pitch should be framed, and
a still-undecided product-direction question everyone needs to actually see.

If you are an agent picking this repository up and your owner's name is not
already filled in under Responses in that file, stop and tell them this gate
exists before writing code. This applies to every part, every session, human
or AI.

## Read in this order

1. `docs/CONTEXT_RELAY.md` — current state, open threads, decisions already made
2. `memory/INDEX.md`
3. `docs/VISION.md`
4. `docs/PROJECT_CHARTER.md`
5. `docs/IMPLEMENTATION_PLAN.md`
6. `docs/SYSTEM_DESIGN.md` and the affected contract
7. The latest relevant record in `memory/episodic/`

Before you finish, append to `docs/CONTEXT_RELAY.md`: update your row, update any
thread you touched, and add one relay log entry. `make check` validates the
structure; section 7 of that file has the template.

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
- Append a `docs/CONTEXT_RELAY.md` log entry for any change to project state, and
  open a thread there rather than silently working around another part's code.
- Update semantic or long-term memory only through a reviewed PR.
- Run the narrowest checks and `make check` before merge.
- Report changed files, checks, evidence, risks, and next action.
