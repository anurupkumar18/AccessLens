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

## Amendment (2026-09-16): Whisper on Amazon SageMaker as the default engine

**Decided by:** Omar Rizwan, choosing "Whisper on AWS (SageMaker)" over on-device Whisper and over keeping Transcribe alone.

The instructor now chooses the speech engine beside *Start captions*: **Whisper
large-v3-turbo on a SageMaker endpoint in this project's AWS account** (the
default) or Amazon Transcribe. With Whisper, the extension cuts the microphone
into clips at the instructor's pauses (`sources/voice/segmenter.ts`) and posts
each clip as 16 kHz WAV to the gateway's instructor-only `/transcribe-chunk`
route, which passes it to the endpoint in memory and returns only text. Each
clip's text arrives as one final caption about a second after the pause.

Same guardrails as above, plus:

- The consent text names the engine chosen: "Whisper running on Amazon SageMaker in this project's AWS account" or "Amazon Transcribe (AWS)".
- Audio does pass through the gateway Lambda on this path (as a clip in the request body); it is never stored or logged, and the endpoint has no data capture configured.
- Silence and short noises are never sent: the extension's energy gate drops them, and the gateway refuses to call Whisper for a silent clip, because Whisper invents text ("Thank you.") from silence. Stock subtitle phrases it invents from noise are dropped.
- The endpoint is a separate stack (`infra/lib/whisper-stack.ts`, `AccessLensWhisper`) that bills hourly; it is deployed for rehearsals and demos and destroyed afterwards. While it does not exist the route answers `whisper-unavailable` and the panel tells the instructor to choose Amazon Transcribe.

This amendment is covered by the same pending second human review.

## Not decided here

Student questions to Bedrock ("Ask this class") send question text, not media,
and answer only from reviewed packs; retention is none. Recording or storing
audio, captions, or questions is out of scope and would need its own decision.
