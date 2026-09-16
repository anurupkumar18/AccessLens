# AccessLens (Revised MVP Scope)

## One Diagram, Every Way of Learning

**Hackathon:** Minds & Machines: AI in Education Hackathon 2026

**Primary track:** Learn

**Status:** Revised MVP scope — narrowed from the original AccessLens proposal in
response to two independent readiness critiques (see §9). The scope, name, and
architecture are otherwise unchanged; only the demo narrative's student
persona has been renamed (Priya → Stevie).

**Tagline:** The instructor approves once. Every student understands the same
moment, in the form they can access.

**One-sentence pitch:** AccessLens turns one instructor-approved diagram into a
privacy-preserving, AI-drafted, human-approved Access Pack, then synchronizes a
single live region signal across every student's device as audio, focused
text, or a spatial view — without ever transmitting the live screen.

---

## 1. What changed, and why

The original AccessLens proposal (automatic screen capture, local computer-vision
matching, five simultaneous modes, a student browser extension, and a required
immersive AR renderer) was reviewed twice before any code existed. Both reviews
reached the same verdict from different directions: **the idea is strong and the
governance is exemplary, but the scope was several hackathon projects stacked on
top of each other**, and every one of capture, matching, and AR sync was an
independent way for the live demo to fail.

AccessLens keeps the thesis — one live signal, many accessible representations,
never the raw screen — and cuts everything that isn't required to prove it in
48 hours:

| Cut | Reason |
| --- | --- |
| Automatic screen/tab capture (`getDisplayMedia`) | `getDisplayMedia()` UX is finicky and untestable across judge hardware; replaced with an explicit instructor upload |
| Local OpenCV.js asset matching | Solves a problem the narrowed MVP no longer has — there is only ever one approved asset in session |
| Student Chrome extension | Replaced with a QR-joined web page; removes packaging, permissions, and install risk from the critical path |
| Immersive AR as a required renderer | Demoted from "required renderer" to a future mode; the two judged modes are Hear and Focus/Read, both of which are fully keyboard- and screen-reader-accessible today |
| Five simultaneous student modes | Narrowed to two, built completely, rather than five, built partially |

What stays, unchanged: the privacy invariants, the human-review gate, the
temporary/role-scoped session model, and the "semantic event, never raw
media" architecture. Those were the parts both critiques scored A+, and they
did not cost us any build time — they only cost us discipline.

---

## 2. The problem (unchanged — this scored A+ in both reviews)

An instructor communicates an idea through one format at a time: a labeled
diagram, a dense chart, an animation, a pointer gesture. That moment can pass
before every student can access or process it.

- A blind or low-vision student doesn't know which region is being indicated.
- A deaf or hard-of-hearing student misses the link between speech and a
  changing visual.
- A student with ADHD loses the key idea inside a visually dense image.
- A dyslexic student needs clearer structure or read-aloud support.
- A multilingual student understands the concept but needs terminology support.

Per the U.S. Government Accountability Office (2024), the share of college
students reporting disabilities rose substantially between 2004 and 2020, and
students and disability-services staff describe real barriers around knowing
how to request and use an accommodation in the moment. Support today is
reactive: disclose, request, wait, catch up later. AccessLens removes the
disclosure step and the wait.

---

## 3. How AccessLens works (the narrowed MVP)

### Before class — instructor authors an Access Pack (this is where AI lives)

1. Instructor uploads **one educational diagram** with distinct labeled
   regions (e.g., a cell-cycle diagram with three phases).
2. **Amazon Bedrock (Claude Sonnet 4.6, Nova Pro as fallback)** receives only
   this explicitly uploaded image — never a live screen, never student data —
   and returns a structured **DRAFT** Access Pack: region boundaries and
   labels, concise audio descriptions, a logical reading order, and
   relationships/terminology between regions.
3. Every field is visibly watermarked **"DRAFT — INSTRUCTOR APPROVAL
   REQUIRED"** in the review UI. Nothing is enabled for class use until the
   instructor edits (if needed) and clicks **Approve**.
4. On approval, **Amazon Polly** synthesizes the audio description for each
   region and stores it in S3 alongside the approved pack JSON. Audio is
   generated once, before class — not on demand during the live session —
   so Hear mode has predictable latency and zero live inference cost.
5. **Bedrock Guardrails** runs during authoring: PII masking, prompt-attack
   filtering, denied-topic protection. Guardrails do not validate the pack's
   schema, so every Bedrock response is also validated against a Zod schema
   before it can reach the review UI.

### During class — instructor drives, students follow

1. Instructor opens the approved Access Pack and starts a session.
2. Students join by scanning a **QR code** — a plain web page, no install.
3. Instructor manually selects the current region (a labeled button per
   region — no screen capture, no matching).
4. The extension/session backend sends **only** a semantic event:

   ```json
   { "sessionId": "…", "packVersion": 1, "assetId": "cell-cycle", "regionId": "metaphase", "seq": 12 }
   ```

5. Every joined student device updates within the same render tick:
   - **Hear:** plays the approved Polly audio for that region.
   - **Focus/Read:** enlarges that region, shows its structured text, dims
     the rest.
6. A student who disconnects and reconnects mid-class receives the latest
   `seq` and region immediately — no replay, no gap.

No raw screen, audio, or video is transmitted at any point during class. The
live payload is under 200 bytes.

---

## 4. Getting every critiqued area to a 10

Both prior reviews scored AccessLens against the same eight criteria. Below is
what changed in AccessLens to address each one directly, and what will be shown
to judges as evidence (not just claimed).

### 1. Solve a painful, specific problem — was A+, stays A+

Unchanged. This was never the weak point. The problem statement, GAO citation,
and named barriers (not "improve accessibility" in the abstract) carry over
exactly.

### 2. Build a working demo — was D, target A

The fix is scope, not speed. Every component that previously had a >30%
failure probability (capture chooser behavior, OpenCV matching, AR hotspot
sync, keyboard nav layered on five modes) is either removed or reduced to a
version simple enough to finish and test in hours, not days. Evidence we will
have in hand before presenting:
- 30 consecutive region changes, both student devices updating, zero failures.
- Disconnect/reconnect recovering to the correct region within one event.
- A recorded backup of the exact demo, in case the live version glitches.

### 3. Show measurable impact — was C, target A

Before the demo, we run a short structured comparison with 1–2 target-barrier
participants (or, if none can be recruited in time, an accessibility
specialist standing in — labeled honestly, see §6): time to locate the
correct region and describe the relationship, with and without AccessLens. The
pitch states the measured numbers, not an adjective:
*"Without AccessLens: 40+ seconds and a request to the instructor to repeat the
point. With AccessLens: under 3 seconds, automatically."* This is framed as
**formative usability evidence**, explicitly not a claim about learning
outcomes, grades, or retention — the same honesty the charter already
requires, now paired with an actual number.

### 4. Use AI meaningfully — was D+, target A

This was the sharpest gap, and it's the one the rescoped MVP fixes most
directly. Bedrock is no longer stretch scope — it is the thing that produces
the Access Pack that the entire rest of the demo depends on. What judges see:
- The instructor uploads a diagram live (or shows a pre-uploaded one) and
  watches Bedrock draft the pack in the UI, visibly watermarked DRAFT.
- The instructor edits one field and approves it.
- Polly-generated audio plays in Hear mode moments later.
- Guardrails' PII-masking and denied-topic protections are shown running
  during authoring, not asserted after the fact.

This keeps every use of AI human-reviewed before it ever reaches a student —
satisfying invariant A3 — while making that review step itself the visible
AI story, instead of an invisible footnote.

### 5. Make the experience excellent — was B–/F, target A

Cutting from five modes to two, and from screen capture to manual region
select, means both remaining paths can be finished, polished, and tested
rather than half-built. Every claimed accessibility affordance (keyboard
navigation, NVDA/VoiceOver labels, focus order) is demonstrated live, not
described. If the instructor's device disconnects mid-demo, the failure mode
is "students see nothing new," not "students see something broken."

### 6. Address education-specific risks — was A+, stays A+, gaps closed

The 11 invariants carry over unchanged (see §5, renumbered for AccessLens). The
gaps the reviews flagged — FERPA framing, screen-reader testing, keyboard-only
testing, and the target-learner interview from the original proposal's
"Evidence Still Required" section — are moved from aspirational to required
pre-demo checklist items (§6). This is the one area both reviews already
called best-in-class; the only change is turning documentation into
demonstrated proof.

### 7. Tell a compelling story — was A–, target A

The architecture narrative carries over. What's added is a single named,
grounded scenario carried through the whole pitch instead of introduced only
at the end:

> Stevie is blind. In a normal class, when the instructor points at the
> mitochondrion, she hears "the energy part" and keeps taking notes, unsure
> exactly what everyone else is looking at. With AccessLens, the instructor taps
> "Mitochondrion" on their screen. Stevie's device speaks "mitochondrion — the
> energy-producing region" within a second, at the same moment two sighted
> classmates see it highlighted and enlarged. She didn't have to disclose
> anything, ask a question, or fall behind to get there.

The demo script opens and closes on Stevie, with the architecture explained in
between as *how* it happens for her, not as the headline.

### 8. Have a strong technical differentiator — was B–, target A–

Reviews independently flagged the same honest comparison: PowerPoint Live and
Zoom already offer synchronized captions, translation, and screen-reader
access for *slides delivered through their own software*. AccessLens'
differentiator is narrower and worth stating precisely instead of implying
something bigger:

> AccessLens is not a better slide viewer. It is a synchronization layer that
> works for **any** approved visual — a diagram, a whiteboard photo, a chart
> — and converts one instructor action into simultaneous audio, focused
> visual, and structured text, without ever transmitting the source itself.
> PowerPoint Live requires teaching inside PowerPoint. AccessLens requires
> teaching with anything you can photograph or export as an image.

This is a smaller, truer claim than "revolutionary AR classroom tool," and it
survives a judge's direct "why not just PowerPoint Live?" question, which the
original pitch did not.

---

## 5. Non-negotiable invariants (carried over, renumbered)

| ID | Invariant |
| --- | --- |
| S1 | The live session transmits only semantic events (session, pack version, asset, region, sequence) — never a screen, audio, or camera stream. |
| S2 | An Access Pack is usable in class only after explicit instructor approval. Bedrock-drafted content is visibly marked DRAFT and is never auto-published. |
| S3 | Bedrock receives only the explicitly uploaded instructor asset — never a live screen, never student data, never browsing history. |
| S4 | Every Bedrock response is validated against a Zod schema before reaching the review UI; Guardrails' PII masking, prompt-attack filtering, and denied-topic protection run during authoring but do not substitute for schema validation. |
| S5 | Student devices store no diagnosis, disability label, or accessibility-mode choice on the server. The server does not know which mode a student selected. |
| S6 | Sessions are temporary and course-scoped; connection and session records are explicitly deleted at session end, with TTL as backup cleanup only. |
| S7 | AccessLens does not scrape Canvas or any LMS. Production LMS integration is out of scope for the MVP entirely. |
| S8 | Every mode has a fully keyboard- and screen-reader-accessible path; there is no mode that requires a mouse, camera, or immersive hardware to use. |
| S9 | AccessLens never automatically grades, scores mastery, infers attention or emotion, or requires disability disclosure to use any mode. |
| S10 | AccessLens' pitch and materials distinguish cited external research, measured usability results, and future work. No claim of automatic WCAG, ADA, or FERPA compliance is made. |
| S11 | A camera-based mode for physical (non-screenable) content remains a documented future direction, not a demoed or built feature. |

---

## 6. Required judge evidence (pre-demo checklist)

Carried over directly from review feedback — these are the artifacts we bring
to the table, not claims we make from the stage:

- [ ] 30 consecutive synchronized region changes across two student devices, zero failures.
- [ ] Event-to-render p95 latency, measured and stated.
- [ ] Live reconnect: kill one student connection mid-session, show it recovering to the current region.
- [ ] A test demonstrating a DRAFT pack cannot be used in a session before approval.
- [ ] A DevTools network trace during a live session, showing no image/audio payload beyond the ~200-byte JSON event.
- [ ] A full keyboard-only walkthrough of both modes.
- [ ] An NVDA or VoiceOver walkthrough of both modes.
- [ ] Written feedback from at least one accessibility specialist or target-barrier participant; if a target-barrier participant could not be recruited in time, this is stated explicitly as a limitation, not implied otherwise.
- [ ] Instructor authoring time per diagram, measured (upload → Bedrock draft → approved).
- [ ] A one-slide honest comparison against PowerPoint Live, stating what AccessLens adds and what it does not replace.
- [ ] Bedrock token cost + Polly character cost per Access Pack, shown from the AWS pricing calculator, to demonstrate the live session itself has zero inference cost.

---

## 7. Technical stack (narrowed)

| Layer | Technology |
| --- | --- |
| Instructor authoring UI | React, TypeScript, Vite |
| Student view | Plain responsive web page, no install, joined via QR code |
| Contracts | TypeScript, JSON Schema, Zod |
| Draft generation | Amazon Bedrock Converse API — Claude Sonnet 4.6 primary, Nova Pro fallback |
| Content safety | Amazon Bedrock Guardrails (PII masking, prompt-attack filtering, denied-topic protection) |
| Audio | Amazon Polly, generated post-approval, cached in S3 |
| Live transport | Amazon API Gateway WebSocket API (built from AWS's WebSocket chat template) |
| Backend | AWS Lambda, TypeScript |
| Session state | DynamoDB — explicit delete on session end; TTL as backup only |
| Approved pack + audio storage | S3 (CloudFront not used unless deployment already requires it) |
| Testing | Vitest, Playwright, axe-core, NVDA/VoiceOver manual pass |

Explicitly **not used**, because they do not serve this problem: Textract
(unless the uploaded asset is a scanned PDF), Knowledge Bases/RAG, Bedrock
AgentCore/Strands, SageMaker, Rekognition, Personalize, OpenSearch, Forecast,
Step Functions, CloudFront (unless already required).

---

## 8. 48-hour plan (revised)

### Hours 1–8: contracts, upload, and Bedrock draft path
- Define the Access Pack and LiveEvent schemas (Zod).
- Build instructor upload → Bedrock Converse call → Guardrails → schema
  validation → DRAFT pack rendered in a review UI.
- One checked-in fixture diagram (cell-cycle, 3 regions) as the fallback
  input if live generation is skipped for time.

### Hours 9–16: approval and audio
- Build the approve/edit flow; on approval, trigger Polly generation and
  store pack + audio in S3.
- Enforce S2 (unapproved packs cannot be selected in a session) and write
  the test for it now, not later.

### Hours 17–28: live session
- API Gateway WebSocket + Lambda relay, built from AWS's chat template.
- DynamoDB session/connection state with explicit delete on session end.
- Instructor region-select UI; student web page joined by QR code; Hear and
  Focus/Read rendering.
- Reconnect handling: on reconnect, resend the latest event.

### Hours 29–36: accessibility pass
- Keyboard navigation and ARIA labeling for both instructor and student UIs.
- NVDA/VoiceOver pass; fix what it surfaces.
- DevTools network trace check (S1 verification).

### Hours 37–44: evidence and story
- Run the 30-consecutive-change test and record the p95 latency.
- Run the usability comparison (§4.3) with any available participant.
- Record the backup demo.
- Write and rehearse the Stevie-centered script.

### Hours 45–48: rehearsal only
- No new features. Two full rehearsals. Confirm backup demo, second device,
  and network trace are all ready to show on request.

---

## 9. Provenance of this revision

This proposal responds to two independent readiness reviews of the original
AccessLens proposal, both dated September 15, 2026:

1. A criterion-by-criterion critique scoring the original proposal a C+
   overall, with "Build a working demo" (D) and "Use AI meaningfully" (D+) as
   the critical gaps, driven by an unbuilt five-mode, capture-plus-AR scope.
2. A stricter external review estimating under 2% win probability for the
   unbuilt original scope, recommending the same core cut independently:
   drop automatic capture and immersive AR from the judged MVP, make Bedrock
   load-bearing rather than stretch scope, and rebuild around a single
   diagram-upload-to-synchronized-region pipeline.

Both reviews agreed the problem definition and the privacy/governance
invariants were already strong; both identified the same root cause
(scope exceeding what 48 hours can finish, and AI relegated to a stretch
feature). AccessLens is the proposal produced by taking both sets of feedback
literally rather than partially.
