# Team alignment check — read before you write another line of code

**Status:** OPEN. Blocks further implementation until every contributor listed
in section 5 has added a response. See `AGENTS.md` and `CLAUDE.md` for the
hard-stop instruction that points here, and `docs/CONTEXT_RELAY.md` T-29 for
the tracked thread.

**Why this file exists:** two internal critiques of this project were written
on 2026-09-15 and never shared with anyone but the person who commissioned
them — not committed, not mentioned in a standup, not seen by any of the four
other people who have since built real parts of this system. They contain a
harsh, honest scorecard against the actual hackathon judging criteria this
project is trying to win, plus real external research that changes how the
pitch should be framed. Nobody can be on the same page about a document they
have never seen. This file makes it visible, adds independent research on
top of it, and requires everyone to actually engage with it — read it, answer
the questions, and record an opinion — before the team invests more hours
building without knowing if it's building the right thing.

If you are an agent (human-directed AI or otherwise) picking this repository
up cold: **do not start or continue implementation work until you have added
your own response in section 5.** If your owner's name is not yet filled in
under Responses, stop and tell them this file exists.

---

## 1. Source documents (now committed, read both in full)

- [`HACKATHON_CRITIQUE.md`](../HACKATHON_CRITIQUE.md) — the original
  criterion-by-criterion critique, written 2026-09-15 when zero code existed.
  Scored the project a **C+ overall** with two failing/near-failing criteria:
  "Build a working demo" (D) and "Use AI meaningfully" (D+).
- [`docs/ACCESSLENS_MVP_REVISION.md`](ACCESSLENS_MVP_REVISION.md) — a
  proposed response to that critique (and a second, independent external
  review reaching the same conclusion) that would cut the browser extension,
  automatic screen capture, and the required-AR renderer entirely, replacing
  them with a QR-joined web page, manual region-select, and a Bedrock-drafted
  single-diagram authoring flow. **This has never been decided.** Everything
  built since (a full capture pipeline, a deployed WebSocket relay, a
  Three.js/WebXR AR renderer) was built on the *original* architecture this
  document proposes replacing.

## 2. Updated scorecard, re-scored against what is actually true today

The critique above is 24+ hours stale relative to what's now built and
deployed. Here is an honest re-score, criterion by criterion, against the
same rubric the original critique used.

| # | Criterion | Original | Now | Why |
| --- | --- | --- | --- | --- |
| 1 | Solve a specific problem | A+ | **A+, unchanged** | Never the risk. |
| 2 | Build a working demo | D | **B+, conditionally** | Real capture, real deployed AWS relay (12/12 against live infra, `services/live-session/scripts/integration-test.mjs`), real teammates using the real Chrome extension. But: no recorded evidence the two full timed rehearsals `DEMO_RUNBOOK.md` itself requires have happened; `master` and the integration branch (`accesslens-extension-ar-pivot`) have **diverged** — someone cloning the wrong one sees a materially different, less complete product; the entire "wow" moment still depends on `getDisplayMedia()` working live in an unpredictable venue. Conditional, not earned. |
| 3 | Show measurable impact | C | **Still C — nothing has changed here** | T-09 in `docs/CONTEXT_RELAY.md` ("no external biology instructor or accessibility professional has reviewed the pack") is still open. This is the single cheapest fix available and nobody has done it. |
| 4 | Use AI meaningfully | D+ | **Still weak, maybe C-** | Bedrock is real and working (`scripts/build-pack.ts`, Claude Sonnet 4.6 on Bedrock) — but the pack actually used in the flagship demo (`bio-cell-demo`) was not Bedrock-generated. If the live demo never shows Bedrock running, a judge sees zero AI regardless of what exists in a script nobody runs on stage. |
| 5 | Experience excellent | B-/F | **Trending B, same caveat as #2** | Contingent on the live capture moment working. |
| 6 | Education-specific risk | A+ | **A+ — your best asset, protect it** | Every invariant (A1-A11) has held under real implementation pressure all session. One live risk: language. See section 3. |
| 7 | Compelling story | A- | **Split-brain risk** | The original critique's fix ("tell it from the student's perspective") was already adopted almost verbatim as the "Stevie" narrative in the still-undecided revision doc. If two people on this team pitch two different products because they never saw the same decision, that's worse than either story alone. |
| 8 | Technical differentiator | B- | **Real, but needs sharpening — see research** | See section 4. |

## 3. A language warning, said directly because it matters

Do not describe personalization as catering to students' "medical conditions"
or "disabilities" in any pitch material, slide, or conversation a judge might
hear. The single highest-scoring thing this project has — the *only* A+ both
independent reviews agreed on — is that AccessLens never diagnoses, labels,
or medicalizes a student (charter A4/A8: no disability inference, no
diagnosis, no assigned learning style). Students choose a **mode**, based on
**preference** — never a condition. This framing is not a nitpick; it is the
project's core differentiator and the thing a hostile or accessibility-literate
judge is most likely to probe. Getting this sentence wrong out loud costs
more than any code bug would.

## 4. Research pulled in from outside the team, with citations

**Your most dangerous competitor is not who the original critique named, and
it's free.** PowerPoint's built-in Live Captions already does real-time
speech transcription and translation into 60+ languages, ships in a tool
every instructor already has open, no install, no signup. A judge who has
used PowerPoint recently will ask "why not just that?" The honest, structurally
true answer: captions transcribe what is *said*, not what is *on the slide*.
A caption cannot tell a blind student a diagram has three labeled regions and
which one the instructor is currently indicating. Say explicitly that you are
not competing on captions — you are solving the part captions cannot reach.
([Microsoft: real-time captions/subtitles in PowerPoint](https://support.microsoft.com/en-us/powerpoint/present-with-real-time-automatic-captions-or-subtitles-in-powerpoint))

**Real third-party research exists to cite instead of inventing your own
numbers.** Institutions fully implementing multimodal (Universal Design for
Learning) instruction measured a 37.4% increase in overall learner
performance and 42.8% for "disengaged learners"; a separate quasi-experimental
study found a multimodal assistant beat a text-only one with a large effect
size (d = 1.59). This is real, citable, external evidence that multimodal
accessible delivery works *in general*. Use it to justify the architecture.
**Do not let it slide into implying it is AccessLens's own measured result** —
that exact overclaim is what the original critique's criterion #3 already
warned against.
([UDL systematic review](https://doi.org/10.3390/computers15070433) ·
[UDL effectiveness meta-analysis](https://www.tandfonline.com/doi/full/10.1080/2331186X.2023.2218191))

**Be precise about what the AR helps with, and who it does not help.**
Accessibility research on 3D/spatial content for blind students specifically
favors **tactile** (physical, audio-annotated) models — a screen-rendered
WebGL scene is not usable by someone who cannot see a screen, regardless of
sync quality. The AR mode genuinely helps low-vision and sighted students who
process spatial relationships differently, and anyone on a WebXR headset. It
does **not** independently help a fully blind student — for that population
the *audio description of the same event* is the actual accessible artifact,
and the 3D model is irrelevant to them except as the source of hotspot
metadata. If a pitch claims "our AR helps blind students," an
accessibility-literate judge can reasonably call that out.
([3D-printed tactile models for blind learners, CHI 2025](https://dl.acm.org/doi/10.1145/3706598.3713706) ·
[Audio-based AR guidance for blind users](https://www.researchgate.net/publication/344268104_An_Audio-Based_3D_Spatial_Guidance_AR_System_for_Blind_Users))

The actual judging rubric for "Minds & Machines: AI in Education Hackathon
2026" was not publicly findable — the event's Luma page does not publish it.
Everything above is calibrated against this team's own critique document, not
a confirmed external rubric. **Whoever has the organizer's actual rubric
should paste it into this file.**

## 5. Questions — answer every one, in your own section below

**Timeline & format:**
1. How much actual time is left before judging, in hours?
2. Is the demo live in front of judges, a recorded video submission, or both?
3. Is there a hard requirement to show working AWS infra, or is a rehearsed local demo enough?

**The two cheapest, highest-leverage fixes available:**
4. Has anyone — a student with a relevant access need, or an accessibility professional — actually looked at this yet, even for 15 minutes?
5. If not: can you get even one person to try it, timed, before/after, this week?
6. Have the two full timed rehearsals `DEMO_RUNBOOK.md` requires actually happened?
7. Is there a recorded backup demo, in case live screen-share fails in front of judges?

**The decision that has been open this entire time:**
8. Had you seen `docs/ACCESSLENS_MVP_REVISION.md` before this file existed?
9. Is anyone currently planning to pitch the narrowed "Stevie" story, the original AR-required story, or does nobody know yet?

**AI visibility in the actual demo:**
10. Does the demo script include a moment where a judge *sees* Bedrock run (upload → draft → DRAFT watermark → approve), or does the live demo only ever show the pre-approved bio-cell-demo pack?
11. If the latter: is there room in the time slot for the Bedrock authoring pipeline as its own 20-30 second beat?

**Team alignment:**
12. Before this file existed, did you know about the critique, the revision doc, or this scoring gap at all?
13. Who is actually presenting, and have they seen the current, real state of the product — not the plan, the actual working thing?

**Scope discipline:**
14. Given everything discussed in the personalization/content-authoring design work this session — none of it is built yet. Is building it before judging actually worth the risk, versus spending the same hours on rehearsal, the one real user interview, and fixing the `master`/integration-branch divergence? Say so if you disagree with prioritizing the latter.

---

## 6. Responses

Copy this template into your own subsection. Sign it — a response with no
name attached does not close this thread. Answer every question in section 5,
even briefly, and add your own honest opinion of where the project actually
stands — agreement with the scorecard above is not required, disagreement is
useful data.

### Anurup Kumar (Part 1)

*(filled below)*

**Answers to section 5:** See the questions above — I posed most of them; my
own answers are context already established across this session's
conversation, not repeated here to avoid duplicating this document with
itself. My opinion: the scorecard in section 2 is my honest assessment, not a
committee compromise. The two items I'd push hardest on before writing more
code are #3 (measurable impact — cheapest fix, nothing done yet) and #7 (the
`master`/integration-branch divergence — a real, silent risk that costs
nothing to fix and could visibly embarrass the team if a judge or teammate
clones the wrong branch).

### Jacob Erard (Part 2)

*(awaiting response)*

### Kunj Rathod (Part 5)

*(awaiting response)*

### Omar Rizwan (Part 4)

*(awaiting response)*

### Prachi Aswani (Part 3)

*(awaiting response)*

### Other contributor

*(copy this section if you're not listed above — name yourself)*
