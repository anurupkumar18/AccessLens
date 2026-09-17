# Find the slide inside window and whole-screen shares (cross-branch integration)

## Goal

Shifted this session from independent feature work to cross-branch
integration: survey every remote branch, bring in genuinely valuable and
safe teammate work without disturbing branches others are actively using or
overwriting this session's own commits, and produce a prioritized assessment
of what's actually out there.

Surveyed 14 remote branches. Most (`workstream/2-instructor-capture`,
`workstream/3-student-ar`, `workstream/4-aws-live`, `docs/aws-access-verification`,
`fix/ci-pnpm-corepack-order`, `claude/product-vision-scope-2uxb6j`) had zero
commits not already in this branch's history -- already absorbed. Two are
huge (`integ/ui-api`: 111 unique commits; `workstream/6-authoring`, an
ancestor of it: 94) and turn out to be the same effort -- Jacob's "Part 6"
authoring pipeline, which builds real AWS Bedrock calls, document ingest,
and RAG retrieval. That bypasses the institutional-approval gate this
branch's own charter has enforced all session (AL-042/AL-045 are
deliberately disabled placeholders); not merged, flagged for a human
decision instead. `ui/blacksmith-revamp` (14 commits, today, Omar Rizwan) is
a mix: real bug fixes, an independently-built caption system (collided with
this session's own AL-048/049/050), an "AWS AI gateway" with live Bedrock/
Polly, and a "Dyslexic" reading mode also present on `master`'s one code
commit and throughout `docs/ADVANCED_FEATURES.md` -- a team-wide naming
pattern this branch's own AGENTS.md flags as medical-condition framing
("student-selected local preferences," never a diagnosis label). Not merged
either; flagged.

This record covers just the one clean, isolated, high-value piece pulled
from `ui/blacksmith-revamp`: `8fde5aa`, "Find the slide inside window and
whole-screen shares."

## What was integrated

Only tab shares ever synced. The pack fingerprints cover the slide image
alone; a shared window adds the viewer's toolbar and margins, a shared
screen adds the menu bar, dock, and other windows -- both push the
whole-frame fingerprint well past match threshold. This was a real gap
directly blocking AL-001's window/display capture cases. The fix: when the
browser reports a `window` or `monitor` surface, search for a 16:9 rectangle
inside the frame via a summed-area table of luminance, then re-fingerprint
the winner. Tab shares keep the original path.

## Changed files

Cherry-picked `8fde5aa` onto this branch:
`apps/extension/src/instructor/{InstructorPanel.tsx,captureController.ts}`
and their tests, `apps/extension/src/sources/screen/{captureHost.ts,
displayMediaHost.ts,index.ts,sampler.ts,README.md}`, new `locate.ts` +
`locate.test.ts`, and `fixtures/index.ts`. One real conflict, in
`InstructorPanel.test.tsx`: two independent new test cases inserted at the
same point (this session's caption/unmount tests, Omar's window-surface
test) -- resolved by keeping both. Everything else auto-merged cleanly.

Also fixed `locate.test.ts`'s whole-screen search test, which reproducibly
timed out under `make check`'s full parallel worker load (40 test files at
once) while passing reliably alone (~7.7s) -- gave it an explicit 20s
timeout rather than leaving an intermittently red gate.

## Validation evidence

354 extension tests pass, `npm run typecheck` clean, `make check` reproduced
green twice in a row after the timeout fix (it failed twice before that fix,
consistently, which is what confirmed the flake was real and load-dependent
rather than a one-off).

## Data and scope boundary

No contract or data-handling change; purely instructor-side local matching
logic and UI messaging.

## Blocker

None for this integrated piece. Real-device verification against actual
`getDisplayMedia()` window/screen captures remains AL-001's open matrix
item, unchanged by this integration.

## Owner

Codex, at Anurup Kumar's direction, executing the session's `/goal` shift to
cross-branch integration, QA, and priority assessment.

## Next action

Produce the full cross-branch SWOT/priority document (separate deliverable);
continue evaluating whether any other isolated pieces of `ui/blacksmith-revamp`
(the reconnect/retry/`close()` fixes in `94f0047`) can be safely separated
from its AI-gateway and dyslexic-mode content.
