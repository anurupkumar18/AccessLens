# AccessLens Demo Runbook

## Three-minute story

### 0:00–0:30 — Problem

Show a crowded biology slide and explain that the lesson moves at one speed and in
one format even when students need different ways to access it.

### 0:30–1:00 — Instructor consent

Open the instructor extension, select **Start Session**, and show the browser's
tab/window/screen chooser. State clearly that AccessLens cannot capture silently.

### 1:00–2:00 — Automatic synchronized access

Advance the biology deck. Show two student extension views updating automatically:

- Student A uses Focus View and sees only the current diagram region.
- Student B uses the extension's AR View and sees the same organelle selected in a
  manipulable spatial cell model, with structured text and requested audio beside it.

Indicate the mitochondrion and show both extensions move to the same region and the
AR model highlight it without a student camera, refresh, or manual slide selection.

### 2:00–2:30 — Trustworthy failure

Open an unapproved slide. AccessLens must show **Unmatched** rather than inventing a
description. Use the instructor correction control to select the intended asset.

### 2:30–3:00 — Architecture and future

Explain that frames are matched locally, AWS relays semantic events, the AR renderer
runs on the student device, and student preferences stay local. Show camera mode as
the advanced source adapter for labs and physical demonstrations.

## Required setup

- clean unpacked extension installation;
- one instructor browser profile;
- two student browser profiles or windows;
- checked-in biology Access Pack;
- checked-in AR cell model and equivalent non-immersive controls;
- deployed temporary WebSocket endpoint;
- headphones for requested audio; and
- recorded fallback demo.

## Rehearsal checklist

- [ ] Capture permission appears and denial is handled.
- [ ] Five planned slide changes match correctly.
- [ ] Both student views follow the same ordered event.
- [ ] The AR cell model selects the same organelle as the instructor event.
- [ ] The equivalent keyboard/touch route reaches the same labels and relationships.
- [ ] Audio starts only when requested.
- [ ] Unmatched content never receives generated details.
- [ ] Pause and Stop update student views immediately.
- [ ] No camera is required.
- [ ] No claims of measured learning or legal compliance are made.
- [ ] Demo finishes under three minutes twice.
