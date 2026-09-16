# AccessLens: Hackathon Readiness Critique

**Date:** September 15, 2026  
**Assessment:** Strong concept with exceptional governance; critical execution risk.

---

## The Winning Formula: Where You Stand

**Formula:** Narrow problem + real user value + polished demo + credible impact + responsible AI

| Component | Your Status | Grade |
|-----------|-------------|-------|
| **Narrow problem** | Exceptionally well-defined: "one-format classroom" with GAO-backed research | A |
| **Real user value** | Clear and validated against disability research | A |
| **Polished demo** | Detailed runbook, but **ZERO CODE WRITTEN** | F |
| **Credible impact** | Deferred to "usability evidence only" (responsible but weak for judges) | C |
| **Responsible AI** | Genuinely exemplary: 11 non-negotiable invariants | A |
| **Overall** | **Excellent strategy, extremely risky execution** | C+ |

---

## Criterion-by-Criterion Scoring

### 1. Solve a Painful, Specific Problem — **A+**

**What you do right:**
- Problem is **one student, one clear unmet need**: blind/deaf/ADHD/dyslexic/multilingual students losing the lesson while it continues.
- Backed by U.S. Government Accountability Office research (2024) on accommodation barriers.
- Not vague ("improve accessibility") — you name the exact barrier (dense visual, fast explanation, unlabeled diagram).
- Scope is intentionally narrow: focus on live synchronization, not Canvas scraping or permanent accessibility retrofitting.

**Critique:**
- ✅ This is your strongest piece. Don't water it down in the pitch.

---

### 2. Build a Working Demo — **D**

**What you do right:**
- Clear acceptance criteria (14 items, specific and testable).
- Detailed 3-minute story with failure modes (unmatched content, pause/resume, correction UI).
- Runbook includes rehearsal checklist.
- Scope is reasonable: one deck, two student modes, one AR scene.

**Critical blocker:**
- **"The browser extension and AWS session service are the next engineering slices"** — you have zero code as of Sept 15.
- In a 48–72 hour hackathon, you need the extension, local matching, WebSocket relay, student renderer, AR sync, and keyboard/screen-reader support **working and demoed**, not started.
- **Timeline arithmetic:**
  - Hours 1–6: shell & contracts
  - Hours 7–18: instructor capture & matching
  - Hours 19–30: AWS WebSocket
  - Hours 31–40: student modes & AR
  - Hours 41–48: testing & rehearsal
  - **Reality check:** 48 hours assumes near-perfect execution with no debugging. You don't have day-zero foundation. You'll lose 12–24 hours debugging, testing permission denials, WebSocket reconnect, AR sync off-by-one errors, keyboard access bugs, etc.

**Impact if things go wrong:**
- Non-functional extensions = disqualified.
- Partial sync (AR lags, student views out of order) = looks broken, loses "wow."
- AR hotspot mapping bugs = core feature fails.
- Keyboard/screen-reader shortcuts not in = accessibility demo showing inaccessible code.

**Verdict:** You have a runbook for a demo you cannot build in time. **This is your biggest risk.**

---

### 3. Show Measurable Impact — **C**

**What you do right:**
- You explicitly disclaim premature claims: "Hackathon feedback is usability evidence, not proof that AccessLens improves learning, grades, retention, or graduation."
- Responsible.

**What judges want to hear:**
- Time saved (how much faster do students understand a region if they see it in AR + text + audio vs. just visual?).
- Engagement ("students paid attention longer in Focus View").
- Accessibility barrier removed ("blind students could locate the exact region for the first time").
- Retention ("students could review the concept in AR after class").

**Your draft pitch says none of this.** You're measuring usability, not impact. Judges want to see **harm reduced** or **learning improved**, not "students found it navigable."

**Gap:** You need a 30-second impact statement for each mode:
- Focus: *"Students with ADHD saw **50% fewer visual elements**, completing the diagram in half the time."*
- Audio: *"Low-vision students could locate the organelle without asking the instructor to repeat the description."*
- AR: *"Students retained the spatial relationship after class by replaying the model."*

**Verdict:** Without this, you lose a major scoring lever. You're betting on **wow factor** over **measurable good**.

---

### 4. Use AI Meaningfully — **D+**

**Red flag for an AI-in-education hackathon.**

**Where you *could* use AI (and don't in MVP):**
- Textract: Extract text from slides automatically.
- Bedrock: Generate initial audio descriptions.
- Translate: Multilingual support.
- Polly: Text-to-speech for captions.
- MediaPipe: Gesture/hand recognition for camera mode.

**Your MVP uses none of these.** You're relying on:
- Checked-in mock content (manual).
- Three.js for AR (geometry, not AI).
- Browser capture + local OpenCV.js matching (old computer vision, not ML).

**Why this matters:**
- Judges are scoring an "AI in Education" hackathon. AR sync + accessible modes is excellent **UX design**, not **AI innovation**.
- A competitor with Bedrock-generated audio descriptions + Translate + human review would beat you on "Use AI meaningfully."

**Your counter-argument (valid but risky):**
- "AI should not run automatic content generation without human review—that violates [A3] of our charter."
- "The MVP uses human-reviewed content to prove the sync architecture works. Camera mode and Bedrock come later."
- **This is honest and responsible, but judges might not care.** They want to see GPT/Claude/Bedrock in the demo, even if gated by review.

**Verdict:** You're building an **accessibility infrastructure** that happens to work with AI-generated content. That's valuable for education, but not a strong AI story for this hackathon. Consider:
- Bedrock-generated audio descriptions (with **"DRAFT - INSTRUCTOR APPROVAL REQUIRED"** watermarks).
- Claude-powered reading-order extraction from slides.
- Polly for quick multilingual captions.
- **All labeled as "AI-assisted, human-reviewed"** to stay within your charter.

---

### 5. Make the Experience Excellent — **B–** (on paper) / **F** (if broken)

**Design is thoughtful:**
- ✅ Students choose modes once, then follow automatically (friction-free).
- ✅ No diagnosis required; modes are choices, not assignments.
- ✅ AR + equivalent keyboard/voice path (redundancy shows accessibility thinking).
- ✅ Pause/Resume/Stop are intuitive.

**Experience if code works flawlessly:**
- Instructor clicks Start, sees browser chooser, shares biology tab. ✅
- Student A sees Focus View instantly. ✅
- Student B sees AR cell with same organelle highlighted as instructor points. ✅
- Both are in sync within 200ms. ✅
- "Wow." ✅

**Experience if code is 80% there (most likely scenario):**
- Instructor clicks Start, browser chooses wrong display (getDisplayMedia() UX is finicky). ❌
- Student A's Focus View loads but is blank (CSS didn't load). ❌
- Student B's AR scene renders but the cell is rotated 90° and the mitochondrion isn't highlighted. ❌
- AR hotspot is off by 50 pixels. ❌
- Keyboard shortcut to next hotspot doesn't work. ❌
- Judges think: *"Design is thoughtful but product is unpolished."* You lose points.

**Verdict:** The *idea* of the experience is excellent. The *execution risk* is enormous.

---

### 6. Address Education-Specific Risks — **A+**

**This is your strongest technical section.**

Your 11 non-negotiable invariants are exemplary:
- ✅ A1: No silent capture (instructor consent).
- ✅ A2: Semantic events, not raw video.
- ✅ A3: Human review gate for generated content.
- ✅ A4: No learner profiles or disability inference.
- ✅ A5: Temporary, role-scoped sessions.
- ✅ A6: No Canvas scraping in MVP.
- ✅ A7: Equivalent non-immersive paths.
- ✅ A8: No automatic grading or attention inference.
- ✅ A9: No mandatory camera.
- ✅ A10: No false compliance claims.
- ✅ A11: AR is required renderer, not surveillance.

**What most submissions are missing:**
- FERPA/privacy audit.
- Bias testing (does AR scene render organelles at different colors for different students?).
- Age-appropriate safeguards.
- Screen-reader testing.
- Keyboard-only paths.

**You have all of this in your charter.** Judges will notice.

**Gap:**
- Section 16 says *"Before using a lived-experience story in the pitch, interview at least one student who encounters the selected barrier."*
- **Have you done this yet?** If not, be very careful. Don't claim "blind students love this" without talking to a blind student and an accessibility professional.

**Verdict:** You've thought deeply about harm and trust. This is rare and impressive. Keep it front-and-center in the pitch.

---

### 7. Tell a Compelling Story — **A–**

**Your story structure is solid:**
1. Problem: Crowded slide, class moves on, student loses the lesson. (0:00–0:30)
2. Consent: Show browser capture chooser. (0:30–1:00)
3. Solution: Two student views sync automatically. (1:00–2:00)
4. Failure case: Unmatched content, then correction. (2:00–2:30)
5. Architecture: Local matching → AWS relay → student AR. (2:30–3:00)

**What's missing:**
- **Human stakes.** Your runbook talks about UI and architecture, not the student. Rewrite it from the student's perspective:
  - *"Priya is blind. In a normal class, when the instructor points at the mitochondrion, she hears 'the energy part' and keeps taking notes, lost. Today, when the instructor points, her AR cell highlights the same organelle, says 'mitochondrion,' and Priya knows exactly what everyone is looking at."*
- **Consequence.** Judges want to feel why this matters:
  - *"Without AccessLens, Priya needed accommodation letters, separate pre-made slides, and time to catch up. With it, she learns in real time, in the same room, without disclosing a diagnosis."*

**Verdict:** Your architecture story is clear. Your human story is absent. Fix that.

---

### 8. Have a Strong Technical Differentiator — **B–**

**Your differentiators:**
- Synchronized multi-modal rendering (focus/text/audio/AR from one semantic event).
- Local approved-asset matching (not real-time scraping).
- AR as a required renderer, not a gimmick.
- Equivalent non-immersive paths.

**Are these enough?**
- ✅ Synchronization is hard (getting order right, handling reconnect, AR sync lag).
- ✅ Multi-modal is rare (most accessibility tools pick one modality: screen reader *or* magnifier, not both).
- ✅ AR is interesting for education.

**Competitors for the same problem:**
- Zoom accessibility features (built-in captions, transcripts, Q&A).
- Accessible PowerPoint (Microsoft Office accessibility APIs).
- ARIA-based web readers (NVDA, JAWS).

**Your advantage:** You're *targeting the live moment*, not post-class. That's novel. But a competitor with **real-time slide-to-3D model generation using AI** (e.g., Bedrock → 3D mesh) would be more differentiated.

**Verdict:** Solid architecture, incremental novelty. Not groundbreaking, but focused.

---

## Execution Risk Breakdown

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Extension doesn't compile/run by demo time | 40% | Disqualified | Start coding **today**. Parallel workstreams. Daily stand-ups. |
| WebSocket relay has bugs (events out of order, duplicates, losses) | 60% | Demo fails (students lag behind instructor) | Heavy integration testing. Chaos testing (kill connections, lag). |
| AR scene doesn't sync with instructor events | 50% | Core feature broken | Lock AR hotspot mapping. Test offline with mock events first. |
| Keyboard/screen-reader shortcuts missing | 70% | Accessibility demo showing inaccessible code | Build keyboard nav in Hours 31–35. Test with actual screen reader. |
| Permission denial flow not handled | 30% | Embarrassing failure during demo | Handle early. Show the error gracefully. |
| Browser capture chooser behaves unexpectedly | 30% | Instructor can't start session | Test on target browser. Have a fallback (tab capture, not full screen). |

**Cumulative probability of a smooth demo (all components working):** ~10–15%.  
**Cumulative probability of a partially broken demo (some lag, one mode down, no keyboard):** ~40–50%.  
**Cumulative probability of a disqualifying failure:** ~30–40%.

**Mitigation:**
- Deploy a **recorded backup demo** ASAP. If the live demo fails, you can still show judges what it would look like (and it still scores points for concept).
- Ship the MVP by Hour 36, not Hour 40. Use last 12 hours for rehearsal and chaos testing, not last-minute features.
- Have a second laptop, second browser profile, and recorded fallback ready.

---

## What You're Actually Competing On

If judges are honest, they're scoring:

| Factor | Your strength | Risk |
|--------|---------------|------|
| **Problem definition** | A+ | None. This is locked. |
| **Research & ethics** | A+ | None. Your charter is exemplary. |
| **Design thinking** | A– | Low. You thought it through. |
| **Technical execution** | Unknown (code unwritten) | **Critical.** This is everything. |
| **Demo polish** | Unknown (code unwritten) | **Critical.** |
| **AI integration** | C (not in MVP) | Medium. Competitors may go deeper. |
| **Impact story** | C (deferred to feedback) | Medium. Needs concrete examples. |

**You're betting on concept and ethics beating execution and demo.** That's not how hackathon judging works. Judges want to *see* it working.

---

## Harsh Feedback on Path Forward

### What You Should Do (Ranked by Impact)

1. **Write code now. Not tomorrow. Today.** Parallel tracks:
   - Track A: Instructor extension shell + browser capture.
   - Track B: Local matching + one mock event.
   - Track C: AWS WebSocket + basic relay.
   - Track D: Student renderer + Focus mode.
   - Track E: AR scene + hotspot mapping.
   - Merge and test integration in Hour 24.

2. **Deploy a recorded fallback demo by Hour 36.** If live demo fails, you have proof the concept works.

3. **Add AI to the pitch.** Even if it's stretch scope:
   - Use Bedrock to generate draft audio descriptions (labeled "draft, needs review").
   - Use Claude to extract reading order from slides.
   - Use Polly for captions.
   - Show this in the demo with a watermark: **"AI-assisted, reviewed by instructor before class."**

4. **Measure and claim impact.** Interview 1–2 students with target barriers (blind, ADHD, dyslexia). Ask:
   - How long did it take to find the region before? (10+ minutes, needed to ask.)
   - How long with Focus + AR? (5 seconds, automatic.)
   - Did you understand the relationship better? (Yes, the AR model showed it spatially.)
   - Pitch: *"AccessLens reduced search time from minutes to seconds and made spatial relationships explicit—without requiring diagnosis or a separate workflow."*

5. **Rehearse twice, record backup, then stop coding.** Hours 41–48 are for polish, not features. A polished 80% is better than a broken 100%.

### What You Should NOT Do

- ❌ Try to add camera mode. It's scope creep. Focus on core sync.
- ❌ Try to add Canvas integration. Out of scope for hackathon.
- ❌ Try to hand-score or grade students. That's the opposite of your charter.
- ❌ Claim that AccessLens "improves learning outcomes." You don't have proof.
- ❌ Try to make AR work in VR mode (immersive AR). Just 3D model in extension is enough.
- ❌ Over-design the instructor UI. Start minimal: button to start, button to choose source, button to stop.

---

## One-Sentence Verdict

**You've defined an exceptionally important problem and designed a thoughtful solution, but you're 2 weeks behind on implementation in a 2-week hackathon. Your entire score depends on whether you can ship a working demo by the deadline.**

---

## Scoring Summary

| Criterion | Score | Comment |
|-----------|-------|---------|
| 1. Solve a painful, specific problem | A+ | GAO-backed, clear, narrow. Excellent. |
| 2. Build a working demo | D | Runbook is great. Code is zero. You're behind. |
| 3. Show measurable impact | C | Deferred to "feedback only." Need concrete examples. |
| 4. Use AI meaningfully | D+ | No AI in MVP. Risk for an "AI in Education" hackathon. |
| 5. Make the experience excellent | B– | Design is thoughtful. Execution is the blocker. |
| 6. Address education-specific risks | A+ | Your charter is exemplary. Best-in-class. |
| 7. Tell a compelling story | A– | Architecture story is clear. Human story is missing. |
| 8. Have a strong technical differentiator | B– | Solid, incremental, not groundbreaking. |
| **Weighted overall** | **C+** | Strong concept, critical execution risk. |

**Hackathon winning potential:** 40% (best case: code works, judges love the story). 15% (base case: partial demo, ethics impression). 0% (worst case: non-functional demo).

---

## What Winning Actually Requires

If AccessLens ships with:
- ✅ Smooth, synchronous demo (no visible lag).
- ✅ Three-minute story told from a student's perspective (Priya's journey).
- ✅ Keyboard nav + screen reader support fully working.
- ✅ Clear evidence of AI-assisted content review (Bedrock description + "reviewed" label).
- ✅ Measured impact from a real student interview.
- ✅ Recorded backup (in case live demo glitches).
- ✅ Zero privacy/surveillance violations.

Then you beat 80% of competitors. Your charter alone is worth points most teams don't have.

**But you need the code working first.**

Good luck. You're building something important. Execution is everything now.
