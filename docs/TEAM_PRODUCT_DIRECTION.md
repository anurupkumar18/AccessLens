# Team Product Direction

## Decision — September 15, 2026

AccessLens is the team's primary hackathon product. This decision supersedes the
Evidence Engine coding-practice product and the broader Canvas AI tutor proposal.

The core product is a Manifest V3 browser extension. An instructor explicitly
shares a tab, window, or screen once. Instructor-side processing identifies the
current approved content and sends temporary semantic events to student extensions.
Students then follow automatically through locally chosen accessible modes.

## Committed MVP

- instructor and student extension modes;
- explicit instructor screen sharing;
- one reviewed biology Access Pack;
- automatic slide and region synchronization;
- two simultaneous student views;
- Focus, structured-text, audio, and synchronized AR modes; and
- temporary AWS WebSocket delivery.

## Stretch only

- camera support for laboratories and physical demonstrations;
- arbitrary-screen understanding;
- production Canvas/LTI integration; and
- automated Access Pack authoring.

The camera is an adapter for situations where screen sharing is impossible, not a
requirement for students or the main product surface.

AR is part of the committed student-extension experience. The shared semantic event
drives both the spatial model and its equivalent non-immersive representation.

## Non-negotiable product behavior

- Capture always begins with an explicit browser permission flow.
- Raw screen and camera media stays local by default.
- The backend receives allowlisted semantic events, not recordings.
- Accessibility preferences and diagnoses are not sent to the instructor.
- Unknown content produces an unmatched state, not an invented description.
- The product does not grade, diagnose, infer attention, or certify compliance.

See `ACCESSLENS_PROPOSAL.md`, `SYSTEM_DESIGN.md`, and `PROJECT_CHARTER.md` for the
complete product, architecture, and safety contracts.
