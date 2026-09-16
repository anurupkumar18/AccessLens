# AccessLens Vision

## One line

AccessLens is a browser extension that follows an instructor's explicitly shared
screen and presents the same live lesson through student-selected accessible modes.

## The problem

Important classroom information is often temporary and delivered in one form: a
crowded slide, fast explanation, unlabeled diagram, animation, website, or software
demonstration. When that form creates a barrier, the class keeps moving.

Students should not need to disclose a diagnosis, operate a camera throughout
class, or wait for a separately produced version to access the idea their classmates
are receiving now.

## Primary users

AccessLens is designed first with disabled and neurodivergent students and made
available to everyone. Initial design partners should include blind or low-vision
students, students with ADHD or dyslexia, multilingual learners, and accessibility
professionals. The product does not diagnose or assign a learning style.

## Core product

The system is a paired browser-extension experience:

1. The **instructor extension** starts a temporary live session and, after an
   explicit browser permission prompt, captures a chosen tab, window, or screen.
2. Instructor-side processing matches the view to a reviewed Access Pack and emits
   semantic events rather than broadcasting raw screen video by default.
3. The **student extension** automatically follows those events and renders the
   current content as audio, focused visuals, structured text, captions, approved
   language support, or spatial guidance.
4. A synchronized AR scene lets the student spatially inspect the current concept.
   The extension provides equivalent non-immersive controls and never converts the
   interaction into an automatic grade or mastery score.

## Where camera mode belongs

Camera mode is advanced, opt-in stretch scope for physical content that cannot be
shared from a computer:

- chemistry or engineering laboratory equipment;
- microscope specimens;
- anatomy models;
- art, architecture, or design critiques;
- music or theater demonstrations;
- field geology, ecology, and archaeology;
- vocational machinery and safety demonstrations; and
- an individual student's own viewpoint when they choose it.

A fixed instructor or lab device may share the demonstration for the whole class;
every student should not need a camera. Raw camera frames are processed locally
where practical and are never used for face, gaze, emotion, attention, or disability
inference.

## What AccessLens is not

- Not a screen scraper running without permission.
- Not classroom surveillance or continuous recording.
- Not an accessibility-compliance certificate.
- Not an automatic grader or mastery estimator.
- Not a system that identifies disability from behavior.
- Not a replacement for formal accommodations or accessible source materials.
- Not dependent on production Canvas access for the hackathon demo.

## MVP

The hackathon MVP is one instructor extension, two simulated student extension
views, one checked-in biology slide deck, Focus, structured text, audio, and a
synchronized AR cell model, with real-time slide/region synchronization through a
temporary AWS session.

The camera source adapter, production Canvas integration, automated Access Pack
generation, and broad course support are advanced or post-hackathon work. AR is a
required renderer throughout the core extension experience, not a camera-dependent
stretch feature.

## Success

The demo succeeds when a judge can see the instructor advance or point at a biology
slide and two student extensions update automatically in different accessible
forms, including the AR model moving to the same organelle, with no student camera,
refresh, or manual slide selection.
