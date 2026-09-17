# AccessLens

> A browser extension that keeps every student synchronized with the instructor's
> live screen and renders the same lesson in a form the student can access.

AccessLens is the primary product for the Minds & Machines: AI in Education
Hackathon. It addresses the **one-format classroom**: an instructor presents a
slide, diagram, video, website, or simulation in one form, and students who cannot
see, hear, parse, translate, or sustain attention on that form lose the lesson as
the class moves on.

The instructor explicitly starts an AccessLens session and chooses a browser tab,
window, or screen to share. The instructor extension recognizes the current
approved asset and sends small semantic events—such as slide ID, highlighted
region, pointer position, caption segment, and sequence number—through a temporary
AWS session. Student extensions follow automatically and render the event through
their chosen modes:

- **Screen readers:** every reviewed description is plain text that VoiceOver,
  NVDA, JAWS and ChromeVox read as the lesson moves; there is no separate audio
  mode;
- **Focus:** one region or relationship at a time;
- **Read:** structured text, read-aloud, or approved language support;
- **Dyslexic:** student-controlled spacing, line length, and dyslexic-friendly
  typography for the same reviewed text;
- **Locate:** spatial directions or haptics; and
- **Explore in AR:** a synchronized spatial model of the current concept, with
  keyboard, touch, voice, and non-immersive equivalents.

Students do not need a camera for the core experience. Camera recognition is a
future, opt-in fallback for content that cannot be screen-shared, such as laboratory
equipment, specimens, studio work, field observations, and physical demonstrations.

## Current status: live on AWS

As of 2026-09-16, on the `ui/blacksmith-revamp` branch, AccessLens runs end to end
against the hackathon AWS account (stack `AccessLensLiveSession`, `us-east-1`):

- **Live sessions.** The instructor starts a session and students join with a
  code and follow along in order, over an API Gateway WebSocket relay (Lambda,
  DynamoDB). Checked against the deployed relay by
  `services/live-session/scripts/integration-test.mjs`.
- **Instructor extension.** Shares a tab, a window, or the whole screen,
  recognizes slides from the reviewed `bio-cell-demo` Access Pack (including
  inside window and screen shares), and says so instead of guessing when a slide
  is not in the pack.
- **Student extension.** Focus, Read, Dyslexic, and AR modes, a light/dark theme, and
  a dyslexia-friendly text switch.
- **AI on AWS** (`services/ai-gateway`). Checked against the deployed routes by
  `services/ai-gateway/scripts/smoke-test.ts`:
  - *Ask this class:* Claude Sonnet 4.6 on Amazon Bedrock answers only from the
    reviewed pack, cites the regions it used, and declines anything else.
  - *Live captions:* Amazon Transcribe, off until the instructor opts in beside
    a consent notice. Students receive text only, and when the instructor names
    a region, students move to it.

Not yet: packs beyond `bio-cell-demo` (a slide must be in a reviewed pack to be
recognized), production Canvas integration, and camera mode. Sending instructor
audio to Transcribe needs a second reviewer before merge (T-31 in
[the context relay](docs/CONTEXT_RELAY.md)). Endpoints come from the stack
outputs; see [the AI gateway README](services/ai-gateway/README.md) to run it.

## Start here

- [Context relay — start here if you are picking this up](docs/CONTEXT_RELAY.md)
- [Local dev setup — the `.env.local` values every feature needs](docs/LOCAL_DEV_SETUP.md)
- [Product proposal](docs/ACCESSLENS_PROPOSAL.md)
- [System design and technical stack](docs/SYSTEM_DESIGN.md)
- [Visualization system: agentic slide visuals](docs/VISUALIZATION_SYSTEM.md)
- [Product vision](docs/VISION.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Five-person parallel workstreams](docs/PARALLEL_WORKSTREAMS.md)
- [bio-cell-demo Access Pack and event simulator](packages/access-packs/bio-cell-demo/README.md)
- [Safety and data charter](docs/PROJECT_CHARTER.md)
- [Demo runbook](docs/DEMO_RUNBOOK.md)
- [Canvas and institutional boundary](docs/CANVAS_INTEGRATION.md)

## MVP journey

```text
Instructor opens the extension
        -> starts a session
        -> selects a tab/window/screen
        -> advances an approved biology deck
        -> extension emits slide/region/pointer events

Student opens the extension
        -> joins the session
        -> chooses an access mode once
        -> automatically follows the instructor
        -> receives Focus, text, caption, audio, and synchronized AR output
```

The MVP uses checked-in mock content. It does not scrape Canvas, silently capture a
screen, store recordings, infer disability or attention, or grade students.

## Repository map

```text
docs/       Current AccessLens product, architecture, contracts, and demo plan
memory/     Historical decisions and compact contributor handoffs
packages/   Reviewed Access Packs; bio-cell-demo is the pack the MVP runs on
tests/      Guardrail suites that run in make check
```

Historical Evidence Engine implementation was removed from the active tree when
AccessLens became the explicit product direction. Git history remains the recovery
path for that superseded prototype.
