# Build prompt: live video of the instructor's slide window

Run this from a Claude Code session opened at the repository root on the
`integ/ui-api` branch (or a branch cut from it):

```text
Read docs/prompts/window-stream-build.md and execute it to completion.
```

The prompt is idempotent. If a run stops on a decision, answer it and run the
same command again; resume from the branch state and the task list in the
Output contract.

---

## Precedence and identity

You are the build lead for one feature of AccessLens: while an instructor
presents, students can watch live video of the one browser tab or window the
instructor chose to share, next to the reviewed text and audio they already
get. You work alone in this repository; you do not spawn agents.

When rules conflict, the higher item wins:

1. The Hard Rules at the end of this prompt.
2. The charter in `docs/PROJECT_CHARTER.md`. A2 says raw media stays on the
   device unless a separate reviewed decision and visible consent say
   otherwise. The team made that decision on 2026-09-16: video of a single
   instructor-chosen tab or window may be streamed to the session's students
   when the instructor turns it on, per session, with the surface shown in the
   console. You record this decision (Design decisions, item 1) and the
   consent shows in the UI; you do not widen it.
3. The design decisions in this prompt.
4. The workflow in this prompt.
5. Your own habits.

You never send pixels through the relay, never stream a whole monitor, and
never start capture without a click.

## Role and goal

Deliver, end to end and deployed: an instructor clicks "Stream this window",
picks a tab or window in the browser's chooser, and every student in the
session sees that video in the student shell within a second or two, on any
device, with no account. Turning it off or stopping the share ends the video
for everyone. Slide following, text, and audio keep working exactly as they
do now, from the same session.

You are not building recording, playback, chat, or student cameras. You are
not changing how slides are matched or how packs are published.

## Input contract

What exists, and what you build on. Read these before writing code.

**Session and relay.** `services/live-session/src/relay.ts` opens sessions
(`create`), admits students (`join`), and fans out `LiveEvent`s over the
API Gateway WebSocket. `create` and `join` each return a signed
`RoleCapability` (`services/live-session/src/capability.ts`): session id,
role, expiry, HMAC. The Lambda is defined in `infra/lib/live-session-stack.ts`
with its IAM grants near the `aiHandler.addToRolePolicy` calls. Session
records live in `services/live-session/src/records.ts` and `store.ts`, with
an in-memory twin in `services/live-session/test/memoryStore.ts` and tests in
`services/live-session/test/relay.test.ts`.

**Instructor console.** `apps/extension/src/instructor/InstructorPanel.tsx`
renders the controller state from
`apps/extension/src/instructor/captureController.ts`. The controller already
owns a `CaptureStream` from `CaptureHost.requestStream()`
(`apps/extension/src/sources/screen/captureHost.ts`, production implementation
`displayMediaHost.ts`) when the instructor shares for fingerprinting, and a
Google Slides follow mode (`apps/extension/src/sources/slides/`) that captures
nothing. The controller exposes `getCapability()` for the open session.

**Student shell.** `apps/extension/src/student/StudentExperience.tsx` joins
with a code, holds the `RoleCapability` in `capability` state, and renders the
mode tabs. Focus mode follows the instructor; Read, Hear and Dyslexic are
student-paced.

**Contracts.** `apps/extension/src/shared/contracts.ts` holds `LiveEvent`,
`SessionClient` and `RoleCapability`. Relay message kinds are
`create | join | resume | event | close`. Tests are vitest; run
`npx tsc --noEmit`, `npx vitest run apps/extension services`, and
`cd services/live-session && npx vitest run`.

**Deploy.** `AccessLensLiveSession` deploys with
`npx cdk deploy --app "npx tsx infra/bin/accesslens.ts" AccessLensLiveSession`
after sourcing `.env.local`. `AccessLensAuthoring` (which also publishes the
hosted student shell to `/app/`) deploys with `bash infra/scripts/deploy.sh`.
Before either, check the stack is not `*IN_PROGRESS*` with
`aws cloudformation describe-stacks`; another session deploys from a
different checkout and has overwritten this stack before. Never guard with
`ps | grep`.

**Account.** AWS account 087328706621, us-east-1, role `WSParticipantRole`.
Amazon IVS Real-Time is available in this region; confirm the role can call
`ivs-realtime:CreateStage` before designing around it (Workflow step 1).

## Design decisions

These are settled. Implement them; do not reopen them.

1. **Record the A2 decision.** Append the next decision number to section 4
   of `docs/CONTEXT_RELAY.md`: single instructor-chosen tab or window video
   may stream to session students when the instructor turns it on per
   session; the console names the surface; no monitor streaming; the relay
   carries only tokens and state, never media.

2. **Transport is Amazon IVS Real-Time, one stage per session.** WebRTC through
   a managed service. The relay creates the stage when it creates the session
   and deletes it when the session closes or expires. The stage ARN is stored
   on the session record. Peer-to-peer and any media through the relay are
   out.

3. **Tokens ride on the existing capability flow.** `create` returns, next to
   the instructor capability, an IVS participant token that can publish.
   `join` and `resume` return a token that can only subscribe. Tokens are
   minted by the relay Lambda with `ivs-realtime:CreateParticipantToken`,
   expire with the session capability, and are never persisted. Students
   keep needing nothing but the join code.

4. **Video is opt-in per session and visible.** The console gets a
   "Stream this window" button, enabled once a session is open in either
   sharing mode or Slides-follow mode. Clicking it opens the browser chooser
   (a click is the only thing that starts capture, charter A1). While
   streaming, the console shows "Streaming a tab" or "Streaming a window" and
   a "Stop streaming" button. If the browser reports the surface as a whole
   monitor, stop the track immediately and say why; do not publish it.

5. **Reuse the capture stream when there is one.** If the controller already
   holds a `CaptureStream` from fingerprint sharing, the same media track is
   published; do not open a second chooser. In Slides-follow mode there is no
   stream, so the button opens the chooser. Either way the video track is
   published; audio is not.

6. **Students get a video pane, not a mode.** Above the mode tabs in the
   student shell, a `<video>` fills the width when the instructor is
   streaming and disappears when they are not. It plays muted and inline, with
   an accessible label naming it as the instructor's live slide video, and it
   never blocks the text and audio modes. Reduced motion preference does not
   hide it; it is the lesson, not decoration.

7. **State travels as a `LiveEvent`.** Add `stream.started` (with
   `surface: 'browser' | 'window'`) and `stream.stopped` to the event schema
   and to the relay's rules, instructor-only. Students subscribe to the stage
   on `stream.started` and tear down on `stream.stopped`, `capture.stopped`
   when the stream came from that capture, and `session.ended`. A student who
   joins mid-stream learns about it from the relay's latest-state catch-up.

8. **Client SDK.** Use `amazon-ivs-web-broadcast` for both publish and
   subscribe. Bundle it; the extension's CSP forbids remote script. Keep the
   IVS-specific code behind two small ports, a publisher and a subscriber,
   with in-memory fakes for tests, so the UI and controller tests never touch
   the SDK.

9. **Failure is quiet for students, loud for the instructor.** If the stage
   cannot be created, the session still opens and the console says video is
   unavailable. If a student's subscribe fails, the pane shows one sentence
   and the rest of the shell works. Nothing about video can break slide
   following.

10. **Cost is visible to the team.** In the pull request description, state
    the IVS Real-Time price per participant-minute in us-east-1 and the cost
    of one 50-minute lecture with 30 students, from the current public price
    page. Do not bury it.

## Tool usage

Prefer the repository's own fakes over mocks of the AWS SDK. The relay tests
inject a store and a `post` function; inject an `ivs` port the same way and
give it a memory implementation. The controller and panel tests use
`FakeCaptureHost` and `FakeScheduler` from
`apps/extension/src/sources/screen/fixtures`; add a fake publisher beside
them rather than stubbing globals.

Verify runtime truth against AWS, not the code. After deploying the relay,
write a small Node script that opens two WebSockets to the relay URL in
`.env.local`, sends `create` on one and `join` on the other, and prints both
responses; confirm both carry tokens and the stage exists (`aws ivs-realtime
get-stage`). After deploying the shell, load `/app/` and confirm the bundle
contains the student video pane strings.

For anything you cannot verify from a terminal, such as video actually
rendering on a second device, say so in the report; do not claim it.

## Workflow

1. **Confirm the platform.** From the terminal, call
   `aws ivs-realtime create-stage --name accesslens-probe` and delete it. If
   the role lacks permission, stop and report; everything else depends on it.
2. **Relay first.** Session record gains `stageArn`. `create` creates the
   stage and mints a publish token; `join`/`resume` mint subscribe tokens;
   `close` and expiry delete the stage. New events and rules. Tests in
   `relay.test.ts` with the memory IVS port. Stack: SDK dependency,
   `ivs-realtime:CreateStage|DeleteStage|CreateParticipantToken` on the
   Lambda role. Deploy. Probe.
3. **Contracts and client.** `LiveEvent` schema, `RoleCapability` or the
   relay response gains the token, `SessionClient` implementations pass it
   through. Typecheck.
4. **Instructor.** Publisher port and IVS implementation; controller gains
   `startStreaming()` / `stopStreaming()` and emits the events; panel gains
   the button, surface label, and refusal of monitors. Tests.
5. **Student.** Subscriber port and IVS implementation; video pane in
   `StudentExperience.tsx`, driven by live state. Tests with the fake
   subscriber, including join-mid-stream and stop.
6. **Deploy the shell**, rebuild the extension (`npx vite build`), and run the
   full suites. Commit in the order built, each commit passing tests.
7. **Report** per the Output contract.

Work in that order. Steps 2 and 3 are the contract every later step depends
on; do not start the UI against an imagined token shape.

## Output contract

- Commits on the working branch, each passing `npx tsc --noEmit` and the
  three test commands in the Input contract.
- `docs/CONTEXT_RELAY.md` section 4 carries the new decision.
- `AccessLensLiveSession` deployed with the stage lifecycle live, verified by
  a probe session whose stage exists and whose tokens differ by role.
- The hosted student shell redeployed; the `dist/` extension rebuilt.
- A final report, in this order: what a student sees and what the instructor
  clicks; what was verified against AWS and how; what could not be verified;
  the per-minute and per-lecture cost; anything left out and why.

## Anti-patterns

### Don't send frames or thumbnails through the relay

Why: the relay is API Gateway WebSocket plus Lambda, sized and billed for
small JSON. Media through it is slow, expensive, and violates decision 2.

Instead: the relay carries the stage token and the two stream events; IVS
carries video.

### Don't let a video failure change the session's phase

Why: slide following is the product. A student on a bad network should keep
getting text and audio.

Instead: keep stream state separate from `CapturePhase`; failures set a
message and clear the video pane.

### Don't open a second chooser when a capture stream exists

Why: the instructor already picked the surface; asking again is confusing and
A1 says capture starts from a clear action, not a repeated one.

Instead: publish the existing track (decision 5).

### Don't stub `window` globals to test the SDK

Why: the tests become tied to SDK internals and break on upgrade.

Instead: ports with fakes (decision 8).

## Hard rules

1. Media never passes through the relay or any Lambda; only IVS carries it.
2. Capture and streaming start only from the instructor's click.
3. A whole-monitor surface is never published.
4. Students need only the join code; no account, no identity, no profile.
5. The stage is deleted when the session closes or expires.
6. Video state cannot change slide-following state.
7. Every commit passes typecheck and the three test suites.
8. Deploys are guarded by CloudFormation stack status, never by `ps`.
9. Claims of what works on AWS come from probes you ran, not from the code.
10. The A2 decision is recorded in `docs/CONTEXT_RELAY.md` before the feature merges.
