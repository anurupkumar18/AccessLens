# AccessLens Product and Data Charter

**Status:** Current operational contract as of September 15, 2026. This charter
supersedes the Evidence Engine coding-practice charter for new product work.

## Thesis

AccessLens provides synchronized, accessible representations of an
instructor-authorized live presentation. It minimizes transmitted data, preserves
instructor control, gives students modality choice without diagnosis, and never
turns accessibility telemetry into surveillance or grading.

## Non-negotiable invariants

| ID | Invariant |
| --- | --- |
| A1 | Screen, tab, window, microphone, or camera capture starts only after a clear instructor or user action and the browser's permission flow. AccessLens never captures silently. |
| A2 | Raw screen, audio, and camera streams stay on the originating device by default. When the instructor explicitly enables AI screen analysis, transient frames may be sent to the configured AWS analysis endpoint with a visible indicator; frames are not stored or relayed to students. The live service still receives semantic events, not a recording. |
| A3 | Access Packs come only from instructor-approved or checked-in public/mock assets. Machine-generated descriptions, regions, translations, and activities remain drafts until human review. |
| A4 | Student accessibility preferences remain extension-local. The server stores no diagnosis, disability label, learner profile, gaze, emotion, attention estimate, or private response history. |
| A5 | Live sessions are temporary, course-scoped, role-scoped, and sequence-checked. Session and connection records expire; a session code is not a general Canvas credential. |
| A6 | The MVP does not scrape Canvas. Production Canvas or LTI access requires institutional approval, least privilege, documented data flow, and an explicit allowlist. Assignments, submissions, quizzes, discussions, grades, and answer keys are excluded. |
| A7 | Every movement-, audio-, vision-, or camera-dependent experience provides an equivalent path targeting the same concept wherever applicable. |
| A8 | AccessLens never automatically grades, determines mastery, diagnoses a condition, evaluates accent or body movement, or infers attention, emotion, confidence, or intent. |
| A9 | Camera mode is opt-in stretch scope for non-shareable physical content. It must not perform face recognition or continuous classroom recording, and every student must not be required to use a camera. |
| A10 | Product claims distinguish external research, observed prototype behavior, design rationale, and future work. AccessLens does not claim automatic WCAG, ADA, FERPA, or institutional compliance. |
| A11 | AR is a required student-extension renderer in the MVP. It is driven by reviewed semantic events, not inferred student behavior, and must have an equivalent non-immersive path to the same labels, relationships, and controls. |

## Allowed MVP data

- opaque temporary session ID;
- signed instructor and student role capability;
- reviewed Access Pack ID and version;
- asset, page, region, and sequence identifiers;
- normalized pointer coordinates;
- instructor-approved caption or description segments; and
- connection timestamps and operational error codes with short retention.

## Prohibited MVP data

- raw screen, camera, or microphone recordings on the server;
- student names, emails, IDs, grades, diagnoses, or accommodation records;
- browsing history outside the explicitly shared source;
- private student responses or accessibility preferences; and
- facial, biometric, gaze, emotion, attention, or behavioral profiles.

## Human review gate

Changes involving capture permissions, remote media, Canvas/LTI, identity,
retention, analytics, automated content generation, or camera mode require a second
human reviewer and updated threat, privacy, and accessibility tests before merge.
