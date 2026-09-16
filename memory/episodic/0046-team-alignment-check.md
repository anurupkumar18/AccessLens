# Commit the hidden critique and force a team alignment check

## Goal

Two internal review documents (`HACKATHON_CRITIQUE.md`, a harsh
criterion-by-criterion scorecard; `docs/ACCESSLENS_MVP_REVISION.md`, a
proposed scope-narrowing response to it) existed only on the user's local
machine since 2026-09-15 — never committed, never seen by any of the other
four contributors who have since built real parts of this system on the
architecture the revision doc proposes replacing. At the user's explicit
request, make this visible to the whole team, add independent research on
top of it, and force every contributor to actually engage with it — read,
answer, and record an opinion — before more implementation happens.

## What was actually possible vs. what was asked

The user asked to "get each of my teammate's LLMs and agents to make them
answer." There is no mechanism available here to reach into another
person's already-running Claude/ChatGPT/Codex session — that boundary is
real and was stated plainly rather than worked around. What *is* actually
enforceable: every contributor's agent session in this repository reads
`AGENTS.md` (an established, actually-followed convention all session) and,
if using Claude Code specifically, auto-loads `CLAUDE.md`. Both were edited
to hard-stop on the new file before any implementation proceeds.

## Changed files

- `HACKATHON_CRITIQUE.md`, `docs/ACCESSLENS_MVP_REVISION.md` — committed
  as-is; previously untracked, existed only locally.
- `docs/TEAM_ALIGNMENT_CHECK.md` (new) — re-scored criterion-by-criterion
  table (was C+ overall; "build a working demo" moved from D to a
  conditional B+, "use AI meaningfully" is still weak since the pack
  actually used in the flagship demo was not Bedrock-generated, "measurable
  impact" is unchanged at C since T-09 is still open); a direct warning
  against framing personalization as serving "medical conditions" (the
  project's core differentiator, both critiques' only shared A+, is
  explicitly *not* diagnosing or medicalizing students); external research
  with citations (PowerPoint Live Captions as the real, free, ubiquitous
  competitor the original critique didn't name; UDL multimodal-effectiveness
  numbers to cite instead of inventing impact claims; a correction that
  accessibility research favors tactile models over screen-rendered AR for
  blind students specifically, so the pitch should be precise about who each
  mode actually serves); and 14 questions covering timeline, the two
  cheapest fixes available (a real user interview, the two required
  rehearsals), the undecided MVP-revision question, AI visibility in the
  actual demo script, and whether to keep building unbuilt design work
  before judging. A Responses section names all five current contributors
  by their actual commit authorship (Anurup Kumar, Jacob Erard, Kunj Rathod,
  Omar Rizwan, Prachi Aswani) with blank templates to fill in.
- `AGENTS.md` — new STOP section inserted above the existing "Read in this
  order" list (not folded into item N, so it can't be skipped past).
- `CLAUDE.md` (new) — did not exist before; Claude Code's auto-loaded entry
  point, pointing to `AGENTS.md` as authority and restating the same
  hard-stop, since this loads automatically regardless of whether a session
  chooses to read `AGENTS.md`.
- `docs/CONTEXT_RELAY.md` — T-29 opened (OPEN, owner "all five parts,"
  blocks "any further implementation"), RL-028 appended.

## Validation evidence

`python3 scripts/relay_check.py` and `python3 scripts/memory_check.py` both
pass with the new thread/log entry and memory record structurally valid.
This is a documentation/process change; no code, schema, or test changed.

## Blocker

T-29 itself, by design — it does not close until Jacob, Kunj, Omar, and
Prachi have each added a signed response. Nothing mechanical in CI enforces
this (deliberately not wired into `--freeze` or the regular `check` target,
which would block unrelated work); it relies on the same read-first
convention this team has already followed all session for `AGENTS.md` and
`docs/CONTEXT_RELAY.md`.

## Owner

Anurup Kumar, at the user's explicit direction.

## Next action

Push this and tell the team directly (outside of git) that it exists — a
committed file nobody knows to look for doesn't reach anyone either. Once
all five responses land, revisit whether to keep building the
personalization/content-authoring design from this session or spend the
remaining time on the cheaper fixes named in section 5 of
`docs/TEAM_ALIGNMENT_CHECK.md`.
