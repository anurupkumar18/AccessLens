# AccessLens advanced feature plan

This document extends the working MVP without changing the privacy charter. It
describes future features, not capabilities that the current demo already has.

## Product principle

AccessLens does **not** record or replay a professor. Review Mode is a new,
asynchronous learning surface built from instructor-approved documents, reviewed
Access Pack content, and a minimal semantic lesson outline. Raw screen, audio, and
camera recordings are not required.

The core loop remains:

`instructor action or approved source -> semantic event -> student-selected representation`

The same event can drive Focus, Read, Hear, Dyslexic, and AR.

## 1. Review Mode: learn after the live class

### Student experience

Students open a **Review** tab from the extension or course page. They do not
watch a recording. Instead, they receive an instructor-published lesson map:

- concept titles and reading order from the reviewed Access Pack;
- approved slide/document links and citations;
- short instructor-approved descriptions;
- the regions or concepts emphasized during class;
- optional instructor-authored questions and examples; and
- a “what to review” list created from the lesson outline, not surveillance.

Students can then:

- move through concepts at their own pace;
- pause, repeat, or skip a concept;
- switch between Focus, Read, Hear, Dyslexic, and AR;
- enlarge text, reduce motion, and use keyboard or voice controls;
- bookmark a confusing concept locally;
- request a simpler explanation or translation from approved course material;
- answer a transfer question; and
- use **Teach It Back** to explain the concept in their own words.

### How it is generated without recording

During class, AccessLens may retain only a temporary sequence of semantic events
such as `assetId`, `regionId`, captions, and timestamps. The instructor chooses
whether to publish a compact lesson summary. The Review page is generated from
that summary plus approved course documents—not from a screen, microphone, or
camera recording.

If the instructor does not publish a summary, Review Mode can still use the
course’s approved Access Pack and documents as a self-paced reference.

### Acceptance criteria

- No raw recording is needed to create or use a review lesson.
- Every student-facing description has an approved source or is visibly marked
  as a draft.
- Review works with cached approved content after the initial load.
- Student notes and bookmarks stay local by default.
- Live and Review states are visually distinct so students never mistake a
  summary for a live feed.

## 2. Live-class additions

### Instructor focus pointer

The instructor can point at or select a reviewed region. Students see the same
region highlighted in every mode. This makes “where should I look?” explicit for
students with ADHD, low vision, language barriers, or processing difficulties.

### Repeat last concept

A student can request the current reviewed description again without interrupting
the class. Audio remains student-requested and concise.

### Live captions and transcript

Show an accessible text stream for approved captions and instructor-provided
terminology. The transcript is a semantic aid, not a recording of the lecture.

### Concept bookmarks

Students can mark “review this later” locally. The instructor receives no
individual attention or difficulty score.

### Camera source for non-screen-shareable teaching

Camera input is an instructor or shared lab-device source for physical content,
not a requirement for students. Examples include chemistry experiments,
microscope work, anatomy models, field demonstrations, and handwritten equations.
The camera produces semantic events; it does not stream continuous video to the
relay. Denied or uncertain camera input falls back to manual region selection.

## 3. Spatial and gesture teaching for professors

Spatial/gesture interaction belongs in the **Instructor Source** layer, before
the existing semantic event contract. It should not create a separate student
product.

### Organic chemistry example

Imagine a professor demonstrating an SN2 reaction at a lab bench:

1. The professor opens **Physical Demonstration** and explicitly grants camera
   permission for the shared instructor device.
2. The local camera view recognizes the reviewed reaction setup or a known visual
   marker on the model. Continuous video remains local.
3. The professor signs or gestures a reviewed chemistry concept with their hands—
   for example, showing the direction of backside attack, rotating a molecular
   model, or indicating bond formation. The first version uses a bounded,
   instructor-configured sign vocabulary rather than pretending to understand
   every possible sign or conversation.
4. AccessLens converts the recognized and confirmed sign into a semantic event,
   for example:

   ```json
   {
     "kind": "lesson.region.indicated",
     "assetId": "sn2-reaction",
     "regionId": "backside-attack",
     "label": "Backside attack",
     "source": "instructor-camera",
     "confidence": "confirmed"
   }
   ```

5. Students immediately receive the same moment in their chosen mode:
   - Focus outlines the nucleophile and reaction center.
   - Read explains the mechanism in reading order.
   - Hear speaks the short description on request.
   - Dyslexic applies the student’s local readability settings.
   - AR places arrows and labels around a 3D reaction model.
6. The professor can correct the region manually if the camera is occluded or
   uncertain. AccessLens never invents a chemical explanation from an uncertain
   frame.

### Sign-language and hand-interaction design

- Start with a small, reviewed sign vocabulary for the target lesson (such as
  nucleophile, electrophile, attack direction, bond break, and bond form). Expand
  toward broader sign-language support only after testing with Deaf signers and
  accessibility experts.
- Do not claim full ASL interpretation from a few chemistry gestures. Signs vary
  by language, community, instructor, and context; the interface must show what
  it recognized and allow the professor to correct it.
- Require a visible confirmation state for consequential events and show the
  recognized concept before broadcasting it to students.
- Use a physical marker, pointer, or on-screen button as a fallback.
- Do not perform face recognition, gaze tracking, emotion inference, or movement
  scoring.
- Do not infer disability, attention, confidence, or mastery from gestures.
- Provide an equivalent non-camera instructor control and equivalent student
  keyboard/text/audio paths.

## 4. Accessible gamification

Gamification should reward exploration and persistence, never expose disability
or rank students publicly.

### Private Review quests

- **See:** inspect one approved concept in Focus or AR.
- **Hear/Read:** access the same explanation in a selected modality.
- **Try:** answer a new transfer question.
- **Teach:** correct an AI learner’s misconception in the student’s own words.
- **Connect:** link the concept to an approved course document or example.

Students see private progress such as “3 of 5 concepts explored.” They do not see
mastery percentages, grades, attention scores, public leaderboards, or streak
pressure.

### Why this is valuable

It gives students who need more processing time a dignified path to continue after
class. A dyslexic student can read with their preferred settings, an ADHD student
can complete one small concept at a time, and a low-vision student can inspect the
same object through AR or audio without asking the class to stop.

## 5. Suggested implementation order

### P0 — Demo-safe additions

1. Add the Review route using checked-in Access Pack content.
2. Add semantic timeline, concept bookmarks, repeat, and private quest progress.
3. Add a polished instructor focus pointer and live caption panel.

### P1 — Course-connected additions

4. Add read-only Canvas course-material retrieval after institutional approval.
5. Generate draft review cards from approved documents; require instructor publish.
6. Add Bedrock agent calls behind the existing gateway placeholder and review gate.

### P2 — Physical-world additions

7. Validate one organic-chemistry or microscope scenario with an instructor and
   accessibility partner.
8. Add the instructor/shared-device camera adapter with local processing.
9. Add confirmed pointer/gesture-to-semantic-event mapping and camera-free fallback.
10. Test low light, occlusion, permission denial, uncertain recognition, and device
    loss before presenting the feature as reliable.

## What not to build

- Professor video recording or replay as the basis of Review Mode.
- Student surveillance, gaze tracking, emotion detection, or attention scoring.
- Public leaderboards or competitive streaks.
- Automatic mastery, grading, or disability classification.
- Unrestricted screen understanding that can hallucinate course content.
- Free-form gesture interpretation without confirmation and a manual fallback.

## Evidence and design references

- [RAND: AI Use in Schools Is Quickly Increasing but Guidance Lags Behind](https://www.rand.org/pubs/research_reports/RRA4180-1.html)
- [UNESCO AI Competency Framework for Teachers](https://www.unesco.org/en/articles/ai-competency-framework-teachers)
- [VisuLearn: AR and gesture-based accessible learning](https://devpost.com/software/visulearn)
- [AccessAI: speech and accessible gamification patterns](https://devpost.com/software/accessai-s27rb5)
