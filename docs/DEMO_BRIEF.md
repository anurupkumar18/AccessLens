# AccessLens — five-minute winning demo brief

## The story to open with (0:00–0:45)

“A live class moves at one speed, but students do not receive information in
the same way. A slide can be unreadable to a dyslexic student, a diagram can be
inaccessible to a blind or low-vision student, and a fast visual demonstration
can disappear before an ADHD student has processed it. Today, the student must
ask the instructor to stop, disclose a diagnosis, or miss the idea.”

This is a current adoption and inclusion problem, not a novelty problem:

- RAND’s 2025 nationally representative survey found that 54% of students and
  53% of teachers used AI for school, while over 80% of students said teachers
  had not explicitly taught them how to use AI for schoolwork.
- UNESCO’s AI competency framework calls for human agency, ethics, inclusion,
  and AI pedagogy—not simply putting an unrestricted chatbot in a classroom.
- The practical gap is the moment instruction happens: accessibility support is
  usually prepared separately, arrives late, or only covers text.

Sources: [RAND (2025)](https://www.rand.org/pubs/research_reports/RRA4180-1.html),
[UNESCO AI Competency Framework for Teachers](https://www.unesco.org/en/articles/ai-competency-framework-teachers),
[Vanderbilt Peabody overview](https://blog.peabody.vanderbilt.edu/the-peabody-blog/understanding-the-future-of-ai-in-the-classroom).

## The one-sentence solution (0:45–1:00)

**AccessLens is a browser extension that lets an instructor share one live lesson
once, then lets every student experience the same moment as focused visuals,
structured reading, audio, dyslexic-friendly text, or synchronized AR—without
requiring a diagnosis or a student camera.**

## Demo setup (before the timer)

- Open the extension in two or three browser tabs/profiles.
- Use the reviewed **Cell Structure** Access Pack.
- Instructor tab: select **Instructor**, keep the capture chooser ready.
- Student tabs: select **Student**, use the join code, and choose different modes:
  Focus, Read, Hear, Dyslexic, and AR.
- Use the local `BroadcastChannel` rehearsal unless the configured AWS WebSocket
  endpoint is available. Do not claim AWS is live unless the environment variable
  is set and verified.
- Keep the unapproved slide available for the safety/failure beat.

## Live script (1:00–4:30)

### 1. Instructor starts once (1:00–1:35)

Click **Start**, explicitly choose the tab/window/screen containing the biology
slides, and read the join code. Say:

“The browser permission is intentional. AccessLens never captures silently. The
raw screen stays on the instructor device; students receive meaning, not a video
recording.”

Advance through the five slides. The local matcher recognizes only the reviewed
pack and emits ordered semantic events (asset, region, pointer, captions, and
lifecycle).

### 2. One event, five accessible experiences (1:35–2:45)

Indicate the mitochondrion region. Without students refreshing or choosing a new
slide:

- **Focus:** highlights the current region and reduces visual clutter.
- **Read:** presents the reviewed reading order and plain-language description.
- **Hear:** plays the concise description on request.
- **Dyslexic:** applies the student’s local readability setting, with larger
  spacing and a dyslexia-friendly font stack.
- **AR:** moves the cell scene to the same organelle and hotspot.

Pause on the two student views and say:

“This is not five separate lesson plans. It is one instructor-authorized event,
rendered five ways. Students choose privately; the instructor never receives a
diagnosis, preference, gaze signal, or attention score.”

### 3. Show the real-time wow moment (2:45–3:25)

Rapidly move to a second organelle and then back. Point to a region and pause.
The student tabs follow automatically and the AR highlight changes with the same
sequence number. Demonstrate Pause/Resume once.

“The accessibility layer follows the class in real time. It is not a static PDF,
a chatbot students must configure, or a recording they watch later.”

### 4. Prove it fails safely (3:25–3:55)

Switch the shared source to the deliberately unapproved slide. Show the
**Unmatched** state. Then use **Fix a wrong match** to select a reviewed slide and
region.

“When AccessLens does not recognize content, it refuses to invent an answer. The
instructor corrects it, and only then does a reviewed event reach students.”

### 5. Explain the physical-world extension (3:55–4:30)

Hold up a real lab object or point to a microscope setup:

“Screen sharing cannot capture a chemistry experiment, anatomy model, or field
demonstration. Our next source adapter uses an explicitly permitted camera on the
instructor or a shared lab device—not every student. It produces the same semantic
event contract, so Focus, Read, Hear, Dyslexic, and AR still work together. A
camera-free/manual path always remains available.”

Do not present camera vision as implemented in this MVP; label it as the next
validated vertical slice.

## Close with impact and credibility (4:30–5:00)

“AccessLens keeps the instructor in control and gives students agency at the
exact moment information is delivered. It helps a dyslexic student read the same
slide, a low-vision student inspect the same organelle, an ADHD student stay with
the current region, and any student revisit the explanation in the modality that
works for them. The class stays together without asking students to disclose why
they need help.”

Then state the boundary plainly:

“Today we prove the real-time extension loop with a reviewed biology pack. Next we
will validate it with mentors and students, add the camera source for
non-screen-shareable labs, connect approved Canvas course materials through
read-only RAG, and integrate Bedrock agents behind human review. We are not
claiming automatic diagnosis, grading, surveillance, or institutional compliance.”

## What is implemented now

- Manifest V3-style Instructor and Student extension views.
- Explicit tab/window/full-screen capture with permission handling.
- Local frame sampling and reviewed-pack slide/region matching.
- Temporary semantic event sessions with local BroadcastChannel rehearsal and a
  configured AWS WebSocket client/relay path.
- Automatic Focus, structured Read, Hear, Dyslexic, and AR renderers.
- AR cell model synchronized to the same asset/region/hotspot event.
- Instructor correction, pause/resume/stop, unmatched-content state, and ordered
  event validation.
- Keyboard navigation, screen-reader labels, reduced motion, text scaling, and
  local student preferences.

## What is planned, not implemented yet

- Camera source adapter for labs and physical demonstrations.
- Read-only Canvas/LTI approval and course-material RAG.
- Bedrock agent/model integration for reviewed descriptions, voice, translation,
  and course-grounded assistance.
- Opt-in anonymous session-context study with no raw media or private chats.
- Separate asynchronous Review page for students who miss the live class.
- Mentor, accessibility-professional, and student validation before expanding the
  demo scenario.

## Judge questions to invite

- “Which part of your teaching cannot be screen-shared?”
- “Which student currently has to ask you to stop or repeat a visual explanation?”
- “Would a semantic event with a camera-free fallback fit your privacy policy?”

These questions turn the demo into a conversation about an adoption-ready need,
not a speculative AI feature list.
