# AccessLens — Implemented Features Inventory

Updated: 2026-09-16

This document records what has been implemented in the AccessLens repository,
including work that exists on integration branches but is not yet part of
`master`. “Implemented” means code and tests exist; an AWS deployment,
credentials, or institutional approval may still be required to exercise it.

## In `master` (`7662617`)

### Extension shell

- Manifest V3 browser extension with Instructor and Student views.
- Local student preferences for mode, text size, and reduced motion.
- Keyboard-accessible mode tabs and non-immersive AR controls.
- Bundled reviewed biology Access Pack and synchronized AR cell scene.
- Remote published-pack loading through a validated HTTPS URL.

### Instructor capture and live synchronization

- Explicit tab, window, or full-screen sharing through the browser permission flow.
- Local frame sampling and capture-stop handling.
- Temporary session creation/join/close lifecycle.
- Ordered semantic events with sequence checking and stale-event rejection.
- BroadcastChannel/in-memory local demo transport and WebSocket transport support.
- Pause, resume, stop, end-session, region indication, and correction controls.

### Student accessibility modes

- Focus mode with the current region highlighted.
- Structured Read mode with reading order and plain-language descriptions.
- Hear mode with requested browser speech playback.
- Dyslexic text mode with accessible typography and adjustable display settings.
- Synchronized AR mode with hotspot focus and equivalent text/keyboard controls.

### Screen-analysis foundation

- `screen.analyzed` event contract for arbitrary screen understanding.
- Validated analysis payload containing title, summary, extracted text,
  audio description, and an optional focus region.
- Configurable transient screen-analysis adapter via
  `VITE_ACCESSLENS_ANALYSIS_URL`.
- Student renderers can display analyzed screen content instead of pack content.
- AWS relay allowlist updated for analyzed-screen events.
- Charter and implementation-plan language updated to require explicit consent,
  transient processing, no frame storage, and visible analysis status.

## Implemented on `origin/integ/ui-api` (`2642724`), not yet merged into `master`

The `ui-api` branch is a larger integration branch containing the following
additional features:

### Instructor and course management

- Google sign-in flow for instructors.
- Instructor self-registration and course/profile library.
- Class invite redemption and class deletion jobs.
- Instructor upload of PDF, PPTX, DOCX, and TXT material.
- AI-generated draft descriptions/captions followed by instructor review.
- Published-pack selection and multi-pack presentation.

### AWS AI gateway

- Bedrock “Ask this class” route grounded in reviewed pack regions.
- Citation validation and refusal for unsupported/off-topic questions.
- Polly speech route for reviewed region descriptions.
- Transcribe streaming route for instructor live captions.
- Caption consent UI and student caption display.
- Voice-driven region following constrained to reviewed regions.

### Presentation and source integrations

- Google Slides following after the instructor starts a session.
- Improved tab/window/screen sharing behavior.
- Pointer/region following and reconnect catch-up.
- Live-session API and AI gateway deployment wiring.
- Local development proxy for published packs, media, and AI routes.

### Student experience improvements

- “Ask this class” student interaction.
- Self-paced reading/hearing of the complete lesson.
- Live captions view.
- Improved audio-region behavior.
- Theme, reading-font, and dyslexia-friendly controls.
- Updated visual interface and responsive extension layout.

## Other branch work

- `origin/workstream/3-student-ar`: student AR renderer and synchronization work.
- `origin/workstream/4-aws-live`: WebSocket relay, temporary capabilities,
  DynamoDB session state, ordering, reconnect, and expiry behavior.
- `origin/workstream/6-authoring`: upload → ingest → AI description → review →
  publish authoring pipeline, with CloudFront pack delivery.
- `origin/ui/blacksmith-revamp`: earlier UI redesign and live-service integration
  work, subsequently incorporated into the integration branch.
- `origin/codex/student-course-experience`: class library/student course
  experience work.
- `origin/codex/course-library-assistant`: approval-gated class assistant and
  invite controls.
- `origin/codex/class-library-deletion-jobs`: durable class deletion retries.
- `origin/claude/demo-proof-sprint-qa`: relay-log, demo-proof, and QA work.
- `origin/docs/aws-access-verification`: AWS account/model access verification.

## Features that are not complete or are configuration-dependent

- An AWS screen-analysis Lambda/API must still be deployed and connected to
  `VITE_ACCESSLENS_ANALYSIS_URL`; the adapter contract is implemented, but no
  generic screen-to-Bedrock endpoint is included in `master`.
- Bedrock, Polly, Transcribe, Google sign-in, course uploads, and WebSocket
  multi-device testing require deployed endpoints and environment variables.
- Production Canvas/LTI integration requires institutional approval and is not
  enabled by default.
- Camera input for physical labs remains a later opt-in source adapter.
- Generated AR scenes from arbitrary screens require a vision prompt, scene
  validator, and approved deployment path.
- Accessibility claims, diagnosis, grading, mastery estimates, surveillance,
  and continuous recording are not product features.

## Verification evidence

- TypeScript compilation passed on the implemented extension changes.
- Targeted extension tests passed (78 tests on the screen-analysis change).
- Access-pack validation and contract tests pass on the reviewed biology pack.
- The `ui-api` branch production build completed successfully with Vite.
- AWS-only features should be verified with the branch-specific deployment
  runbooks and smoke tests before being described as live.
