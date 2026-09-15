# AccessLens Demo Runbook

## Three-minute story

### 0:00–0:30 — Problem

Show a crowded biology slide and explain that the lesson moves at one speed and in
one format even when students need different ways to access it.

Use `packages/access-packs/bio-cell-demo/slides/cell-slide-04.png`, the protein
pathway slide: three regions, small labels, left-to-right flow.

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

That beat is `cell-slide-03`, region `mitochondrion`, hotspot
`cell-slide-03:mitochondrion`, AR node `Mitochondrion`, camera
`mitochondrion-closeup`. The whole five-slide sequence is
`fixtures/happy-path.json`; replay it with

```sh
python3 packages/access-packs/bio-cell-demo/tools/simulate_events.py \
  --scenario happy-path --stream
```

if the instructor capture path is unavailable at demo time.

### 2:00–2:30 — Trustworthy failure

Open an unapproved slide. AccessLens must show **Unmatched** rather than inventing a
description. Use the instructor correction control to select the intended asset.

The slide is `packages/access-packs/bio-cell-demo/demo-assets/unapproved-photosynthesis.png`.
It is deliberately not in the pack, and the pack's guardrail suite asserts it stays
unmatchable: it sits 48 bits from its nearest reviewed slide against a ceiling of
26, and clears the margin rule by 3 bits against a required 14. The scripted
version of this beat, including the correction, is
`fixtures/unmatched-and-correction.json`.

### 2:30–3:00 — Architecture and future

Explain that frames are matched locally, AWS relays semantic events, the AR renderer
runs on the student device, and student preferences stay local. Show camera mode as
the advanced source adapter for labs and physical demonstrations.

## Required setup

- clean unpacked extension installation;
- one instructor browser profile;
- two student browser profiles or windows;
- the `bio-cell-demo` Access Pack, five slides open in a presentation tool in deck
  order, plus the unapproved slide ready in a separate tab;
- `models/cell.glb` loaded and the equivalent non-immersive controls reachable;
- deployed temporary WebSocket endpoint;
- headphones for requested audio; and
- recorded fallback demo.

Run `make pack-check` before rehearsal. It recomputes every slide fingerprint from
the PNG bytes, so a deck edited after the pack was built fails here rather than
mismatching live.

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
- [ ] `make pack-check` passes on the demo machine.
- [ ] Every region named out loud exists in `pack.json`; nothing is described from
      memory.
- [ ] The pack is not described as expert-reviewed or accessibility-audited —
      task A15 has not closed.

## Fallback replays

If capture, the relay, or the network fails mid-demo, every beat has a recorded
event sequence that drives the student extensions directly:

| Beat | Scenario |
| --- | --- |
| Five synchronized slide changes | `happy-path` |
| Unmatched slide and instructor correction | `unmatched-and-correction` |
| Pause, resume, and stop | `pause-resume-stop` |
| Student reconnect | `reconnect-latest-state` |
| Out-of-order events | `stale-and-reordered` |
| Live captions | `captions` |

```sh
python3 packages/access-packs/bio-cell-demo/tools/simulate_events.py --list
python3 packages/access-packs/bio-cell-demo/tools/simulate_events.py \
  --scenario <name> --stream --speed 2
```

This is a live replay of semantic events, not a video. Say so if it is used: the
student extensions are really rendering, only the instructor side is simulated.
