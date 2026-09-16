# Decision: instructor live captions through Amazon Transcribe

**Date:** 2026-09-16
**Decided by:** Omar Rizwan (Part 4), with the explicit choice of "Transcribe + opt-in" over on-device recognition and output-only speech
**Status:** Implemented on `ui/blacksmith-revamp`; **awaiting the second human reviewer** the charter's review gate requires for remote media before merge
**Charter:** A1 (explicit capture), A2 (remote media needs a reviewed decision and visible consent), A4 (no retention), A9 (no invented content)

## Decision

The instructor may turn on live captions. Their microphone audio streams from
their browser directly to Amazon Transcribe over a five-minute presigned URL;
students receive only caption text through the relay. Final captions that name
a region of the slide already matched on screen move students to that region.

## Why

Captions of what the instructor says are the gap on-screen recognition cannot
cover, and a visible AWS model in the live path addresses the weakest judging
criterion in `docs/TEAM_ALIGNMENT_CHECK.md` ("use AI meaningfully"). Chrome's
built-in recognition normally sends audio to Google, and its on-device mode is
not reliably available, so it would not have kept audio local either.

## Guardrails (all implemented and tested)

- Off by default; the microphone opens only from the instructor's *Start captions* click.
- Consent text at the control names Amazon Transcribe (AWS), states students get only text, and that AccessLens keeps no audio.
- Audio never reaches the relay or the gateway Lambda; no AWS credential reaches the extension.
- `caption.appended` carries `{text, isFinal}` only, text <= 500 characters; Zod, the JSON schema, the Python reference, and the relay all reject anything else (`fixtures/invalid/caption-with-audio-payload.json`).
- Captions are labelled for students as live speech, not reviewed text; screen-reader announcement is off unless the student turns it on.
- Voice-driven sync only selects regions of the currently matched reviewed slide; the instructor can turn it off.
- Gateway logs contain no caption, question, or answer text.

## Not decided here

Student questions to Bedrock ("Ask this class") send question text, not media,
and answer only from reviewed packs; retention is none. Recording or storing
audio, captions, or questions is out of scope and would need its own decision.
