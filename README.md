<div align="center">

# 🔍 AccessLens

### Keep every student synchronized with the instructor's live screen, rendered in a form they can actually access.

<br />

🥇 **1st Place — Minds & Machines: AI in Education Hackathon** 🥇
*One-U Responsible AI Initiative · University of Utah · September 2026*

<br />

[![1st Place](https://img.shields.io/badge/🏆_1st_Place-Minds_%26_Machines_2026-FFD700?style=for-the-badge&labelColor=1a1a2e)](https://rai.utah.edu/events/hackathon/)
[![Built at](https://img.shields.io/badge/Built_at-University_of_Utah-CC0000?style=for-the-badge&labelColor=1a1a2e)](https://utah.edu)
[![Status](https://img.shields.io/badge/Status-Live_on_AWS-2ea44f?style=for-the-badge&labelColor=1a1a2e)](#current-status-live-on-aws)

<br />

![Amazon Bedrock](https://img.shields.io/badge/Amazon_Bedrock-232F3E?style=flat-square&logo=amazonaws&logoColor=FF9900)
![Claude Sonnet 4.6](https://img.shields.io/badge/Claude_Sonnet_4.6-D97757?style=flat-square&logo=anthropic&logoColor=white)
![Amazon Transcribe](https://img.shields.io/badge/Amazon_Transcribe-232F3E?style=flat-square&logo=amazonaws&logoColor=FF9900)
![AWS Lambda](https://img.shields.io/badge/AWS_Lambda-FF9900?style=flat-square&logo=awslambda&logoColor=white)
![API Gateway](https://img.shields.io/badge/API_Gateway_WebSocket-FF4F8B?style=flat-square&logo=amazonapigateway&logoColor=white)
![DynamoDB](https://img.shields.io/badge/DynamoDB-4053D6?style=flat-square&logo=amazondynamodb&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)

</div>

---

<!-- ========================================================================
     HERO IMAGE / DEMO GIF
     Drop your best visual here. A 10-to-20-second GIF of the instructor
     advancing a slide and the student view following in Focus + AR mode is
     the single most persuasive thing you can put in this README.
     Recommended: docs/assets/accesslens-demo.gif
     ======================================================================== -->

<div align="center">

> **📽️ Add your demo GIF here** → `docs/assets/accesslens-demo.gif`
>
> *Instructor advances an approved biology deck. Every student view follows in order, each in its own access mode.*

</div>

---

## The problem: the one-format classroom

An instructor presents a slide, diagram, video, website, or simulation in **one form**. Students who cannot see, hear, parse, translate, or sustain attention on that form lose the lesson as the class moves on.

AccessLens is a browser extension that keeps every student synchronized with the instructor's live screen and renders the same lesson in a form each student can access.

<br />

<div align="center">

| One format for everyone | ➡️ | The right format for each student |
|:---:|:---:|:---:|
| A single slide on a projector | | Screen reader, Focus, Read, Dyslexic, Locate, and AR, all in sync |

</div>

---

## How it works

The instructor **explicitly** starts an AccessLens session and chooses a browser tab, window, or screen to share. The instructor extension recognizes the current approved asset and sends small semantic events (slide ID, highlighted region, pointer position, caption segment, sequence number) through a temporary AWS session. Student extensions follow automatically and render each event through the mode the student chose.

```text
Instructor opens the extension
        -> starts a session
        -> selects a tab/window/screen
        -> advances an approved biology deck
        -> extension emits slide/region/pointer events

Student opens the extension
        -> joins the session with a code
        -> chooses an access mode once
        -> automatically follows the instructor
        -> receives Focus, text, caption, and synchronized AR output
```

<!-- ========================================================================
     ARCHITECTURE DIAGRAM
     A simple boxes-and-arrows diagram of the relay path reads as senior work
     to a technical judge. Instructor ext -> API Gateway WebSocket -> Lambda
     -> DynamoDB -> student exts, with the AI gateway (Bedrock, Transcribe)
     hanging off the side. Drop it at docs/assets/architecture.png
     ======================================================================== -->

<div align="center">

> **🧭 Add your architecture diagram here** → `docs/assets/architecture.png`

</div>

---

## Access modes

Each student picks a mode once, then simply follows along.

| Mode | What the student gets |
|:---|:---|
| 🔊 **Screen readers** | Every reviewed description is plain text that VoiceOver, NVDA, JAWS, and ChromeVox read as the lesson moves. No separate audio mode. |
| 🎯 **Focus** | One region or relationship at a time. |
| 📖 **Read** | Structured text, read-aloud, or approved language support. |
| 🔤 **Dyslexic** | Student-controlled spacing, line length, and dyslexic-friendly typography for the same reviewed text. |
| 🧭 **Locate** | Spatial directions or haptics. |
| 🧊 **Explore in AR** | A synchronized spatial model of the current concept, with keyboard, touch, voice, and non-immersive equivalents. |

Students do not need a camera for the core experience. Camera recognition is a future, opt-in fallback for content that cannot be screen-shared, such as laboratory equipment, specimens, studio work, field observations, and physical demonstrations.

---

## Current status: live on AWS

As of 2026-09-16, on the `ui/blacksmith-revamp` branch, AccessLens runs end to end against the hackathon AWS account (stack `AccessLensLiveSession`, `us-east-1`).

### ✅ Working end to end

- **Live sessions.** The instructor starts a session and students join with a code and follow along in order, over an API Gateway WebSocket relay (Lambda, DynamoDB). Verified against the deployed relay by `services/live-session/scripts/integration-test.mjs`.
- **Instructor extension.** Shares a tab, a window, or the whole screen. Recognizes slides from the reviewed `bio-cell-demo` Access Pack (including inside window and screen shares) and says so instead of guessing when a slide is not in the pack.
- **Student extension.** Focus, Read, Dyslexic, and AR modes, a light and dark theme, and a dyslexia-friendly text switch.
- **AI on AWS** (`services/ai-gateway`), verified against the deployed routes by `services/ai-gateway/scripts/smoke-test.ts`:
  - **Ask this class:** Claude Sonnet 4.6 on Amazon Bedrock answers only from the reviewed pack, cites the regions it used, and declines anything else.
  - **Live captions:** Amazon Transcribe, off until the instructor opts in beside a consent notice. Students receive text only, and when the instructor names a region, students move to it.

### 🚧 Not yet

- Packs beyond `bio-cell-demo` (a slide must be in a reviewed pack to be recognized)
- Production Canvas integration
- Camera mode
- Sending instructor audio to Transcribe needs a second reviewer before merge (T-31 in [the context relay](docs/CONTEXT_RELAY.md))

Endpoints come from the stack outputs. See [the AI gateway README](services/ai-gateway/README.md) to run it.

<!-- ========================================================================
     SCREENSHOT GALLERY
     Two or three real screenshots go a long way here: the instructor panel
     mid-session, the student view in Focus mode, and the AR view. Drop them
     under docs/assets/ and swap the placeholders below.
     ======================================================================== -->

<div align="center">

> **🖼️ Add screenshots here** → instructor panel · student Focus view · AR view

</div>

---

## Tech stack

| Layer | What we used |
|:---|:---|
| **AI** | Claude Sonnet 4.6 on Amazon Bedrock, Amazon Transcribe |
| **Real-time relay** | Amazon API Gateway WebSocket, AWS Lambda, Amazon DynamoDB |
| **Clients** | Browser extensions (instructor and student), TypeScript |
| **Infra** | AWS CDK stack `AccessLensLiveSession`, `us-east-1` |
| **Verification** | Integration and smoke tests run against deployed AWS routes |

---

## Built responsibly, on purpose

The MVP uses checked-in mock content. It does **not** scrape Canvas, silently capture a screen, store recordings, infer disability or attention, or grade students. Captions are off by default and turn on only beside a consent notice.

See the [Safety and data charter](docs/PROJECT_CHARTER.md).

---

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
- [Demo runbook](docs/DEMO_RUNBOOK.md)
- [Canvas and institutional boundary](docs/CANVAS_INTEGRATION.md)

---

## Repository map

```text
docs/       Current AccessLens product, architecture, contracts, and demo plan
memory/     Historical decisions and compact contributor handoffs
packages/   Reviewed Access Packs; bio-cell-demo is the pack the MVP runs on
services/   Live-session relay and AI gateway
tests/      Guardrail suites that run in make check
```

---

<div align="center">

**AccessLens** · Winner, Minds & Machines: AI in Education Hackathon 2026

*Built at the University of Utah, powered by AWS and Amazon Bedrock.*

</div>
