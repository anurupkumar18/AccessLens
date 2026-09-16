# AccessLens demo-proof sprint

This is the operator record for A14–A16 and tickets AL-001, AL-004, AL-005,
and AL-006. It turns the current evidence gaps into observable runs; blank cells
are intentionally not evidence. Do not replace them with a claim.

## Release record

| Field | Recorded value |
| --- | --- |
| Release candidate | `cd52f6e` — `merge: consolidate AccessLens integration`; QA re-verified on `1524027` |
| Local automated gate | `make check` passed on 2026-09-16: 61 Access Pack, 24 relay, 5 delivery-board, 274 extension, and 53 live-session tests. Independently reproduced on `1524027` with identical counts |
| Live relay lifecycle release | **BLOCKED** — local machine has no AWS CLI, profile, or environment credentials; no deployment was attempted |
| Second review of `capture.stopped` | **DONE with findings, 2026-09-16** — `docs/work/updates/AL-003-CHECKPOINT-20260916-0652.md`. Statements 2 and 3 confirmed; statement 1 qualified (instructor-only and no media/identity/preference confirmed, but the relay does not enforce base-only for asset/region as it does for `source.unmatched`); statement 4 not applicable until a deployment happens. Opened T-31, T-32 (T-33 subsequently closed via `2d04fad`) — resolve or explicitly accept before deployment |
| Real browser/device evidence | **OPEN** — operator-only; browser permission cannot be granted by an unattended tool |
| Existing deployed relay probe | `integration-test.mjs` passed its 19-event path and refusal checks; the 30-event bench measured 139.3/186.2 ms p50/p95 same-process receive latency and 2.4/11.7 ms skew, but the endpoint rejected `capture.stopped` as `event-type-not-allowlisted` |
| Extension false-live safeguard | `2d04fad` locally handles a relay payload that fails `LiveEventSchema`: the student freezes the last trusted state as non-live without retaining the payload. Unit coverage is green; deployed and real-device evidence remains open. |
| Independent re-probe of the stale endpoint | **2026-09-16, reproduced.** One disposable session, two events, closed immediately: `session.started` accepted, `capture.stopped` rejected as `event-type-not-allowlisted`. The existing endpoint is confirmed stale for AL-003; deployed stop-versus-end behavior must not be claimed |

## AL-003 — contract review and deployment gate

The reviewer must trace `capture.stopped` across the extension Zod and JSON
schemas, Python reference validator, instructor controller, student state, and
relay tests. Confirm all four statements before deployment:

- [~] It is base-only and instructor-only; it carries no raw media, asset,
  region, preference, or identity field.
  **Qualified, 2026-09-16.** Instructor-only confirmed at every layer. No raw
  media, preference, or identity confirmed — `frameData`, `studentId`, and
  `preferences` each bounce as `field-not-on-contract`. Base-only for
  asset/region holds in the Zod and JSON schemas **only**: the relay and the
  Python reference accept a `capture.stopped` carrying a real `assetId` and
  `regionId`, where the same fields on `source.unmatched` are refused. See T-31.
- [x] Stop and browser source termination release local capture but retain the
  temporary session and last trusted student state.
  **Confirmed, 2026-09-16.** One `endSharing()` serves both `stop()` and the
  browser's `onEnded`; `sessionId` is retained, the relay keeps the session open
  and stores the event as latest state, and `liveState.ts` spreads `...current`
  so the last trusted asset/region/hotspot survives.
- [x] A later `session.started` can resume the same session with a monotonic
  sequence; only `session.ended` closes delivery.
  **Confirmed, 2026-09-16.** Restart reuses the retained session id without
  re-`create`, the sequence counter is never reset, and only `session.ended`
  reaches `closeSession`; `join` and `resume` both refuse a closed session.
- [ ] The reviewed service has been rebuilt before CDK deployment.
  **Not applicable yet.** The build is green locally (esbuild → `dist/index.mjs`,
  24.9 kb); no deployment has been attempted, so this cannot be ticked by review.

The full reviewer record, including the reproduction commands, is
`docs/work/updates/AL-003-CHECKPOINT-20260916-0652.md`. T-31 and T-32 must
be resolved or explicitly accepted before this lifecycle is deployed or claimed
(T-33 closed via `2d04fad`).

After the independent review, configure the temporary hackathon profile according
to `docs/AWS_ACCESS_VERIFICATION.md` without committing or sharing credentials,
then build, deploy, and run:

```sh
cd services/live-session && npm run build
cd ../../infra && npx cdk deploy --require-approval never
cd ../services/live-session
node scripts/integration-test.mjs <deployed-websocket-url>
```

Record the deployed URL, commit, reviewer, integration result, and whether a late
joiner receives `capture.stopped`. If any step fails, leave AL-003 in review and
use semantic replay rather than describing this lifecycle as deployed behavior.

## AL-001 — real-device capture matrix

Build the extension with the deployed URL in a local `.env.local`, load it
unpacked into clean browser profiles, and run the following cases on the supported
devices. Use a device label, not a person's name. No capture recording, student
identity, or local preference value belongs in this document.

| Case | Device/browser/source | Expected result | Observed result | Evidence / blocker |
| --- | --- | --- | --- | --- |
| Permission denied |  | Instructor receives truthful denial state; no event session starts |  |  |
| Tab capture |  | Five planned transitions match; both students update in order |  |  |
| Window capture |  | Match, correction, pause, stop, and restart behave as reviewed |  |  |
| Display capture |  | Match and focus switch remain stable under the supported display setup |  |  |
| Source closed |  | Capture stops; students preserve the last trusted state |  |  |
| Unmatched + correction |  | Unknown slide is unmatched; no description is invented; correction is visible |  |  |
| Terminal end |  | Students receive ended state and further delivery stops |  |  |

Two complete core runs must pass before AL-001 is complete. Categorize any
reproduced failure and open AL-002; do not patch capture behavior during a
rehearsal.

## AL-004 — live quality bench

Run the automated relay bench against the **deployed release URL**:

```sh
cd services/live-session
node scripts/quality-bench.mjs <deployed-websocket-url>
```

It creates a disposable session, sends 30 reviewed `region.changed` events to two
anonymous clients, reports same-process p50/p95 receive latency and inter-student
skew, verifies ordered 30/30 delivery, and verifies that a rejoining student gets
the latest `capture.stopped` lifecycle state. It is relay-wiring evidence only.
Repeat the same sequence on two physical student devices with a single
time-synchronized recording or other redacted timing record before describing live
multi-device latency or reliability.

T-33 (closed via `2d04fad`) added local fail-closed coverage for an inbound event
the extension rejects: the UI must say that the next update could not be verified
and retain the last reviewed state. This does not prove the deployed relay's
behavior; record the physical malformed-event or version-skew exercise in the
false-live column.

**Known coverage limit (T-32).** The bench's "rejoining student" reconnects as a
brand-new anonymous `join`. The shipped `WebSocketSessionClient` reconnects by
presenting its stored capability on `$connect`, which reaches `Relay.resume()` —
a different code path with no test anywhere. A green bench therefore proves
join-time catch-up, not the reconnect the demo actually performs.

| Run | Release / endpoint | 30/30 A | 30/30 B | p50 / p95 latency | p50 / p95 skew | Reconnect | False-live state | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Automated relay bench | Existing endpoint; not a verified `cd52f6e` deployment | yes | yes | 139.3 / 186.2 ms | 2.4 / 11.7 ms | Student rejoin accepted; stopped-state catch-up failed | Not measured | **BLOCKED**: `capture.stopped` rejected as `event-type-not-allowlisted` |
| Two-device bench |  |  |  |  |  |  |  |  |

## AL-005 — rehearsals and fallback

Before each rehearsal, run `make pack-check` on the demo machine. Record two
clean-install runs below. A replay may drive real student renderers, but the
presenter must say that instructor capture is simulated whenever it is used.

| Run | Date/time | Clean install | Under 3 min | Core live path | Fallback verified | Known failure / claim limit |
| --- | --- | --- | --- | --- | --- | --- |
| Rehearsal 1 |  |  |  |  |  |  |
| Rehearsal 2 |  |  |  |  |  |  |

The recording must visibly cover permission denial, unmatched correction,
relay/network failure, and semantic replay recovery. Store the recording location
only after the release owner approves its claim language; do not call a replay
live capture.

## AL-006 — formative reviewer kit

Before starting, state: “This is a voluntary formative prototype review. We will
record only your feedback about the prototype, not a diagnosis, profile, grades,
or other personal data. You may skip questions or stop at any time. May we record
your role and feedback in this project evidence?” Obtain an explicit yes before
recording any response.

Show the three-minute run, then ask:

1. Did the instructor-selected visual reference become clearer in Focus, the
   structured route, requested audio, and the spatial route?
2. Did the non-immersive keyboard/touch route preserve the same label, role, and
   relationship as the AR view?
3. Was the unmatched/correction state trustworthy rather than confusing?
4. Was it clear that any AI-authored pack material is a draft requiring review,
   not a live unreviewed answer?
5. What is one concrete improvement you would make before a demonstration?

| Reviewer role (only with consent) | Consent | Observation / quote summary | Material improvement | Scope or claim decision needed |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

Claim audit: never state measured learning impact, accessibility certification,
legal compliance, diagnosis-based personalization, expert review, or that AR
alone serves a fully blind student. A reviewer session is formative evidence, not
a study or audit. AL-007 remains a human decision about whether feedback changes
scope or claims.

## Final release evidence

| Field | Final value |
| --- | --- |
| Release SHA |  |
| Deployed relay endpoint and verification |  |
| `capture.stopped` second-review / deployment state |  |
| Capture-matrix result |  |
| Quality-bench result |  |
| Rehearsal dates and fallback location |  |
| Reviewer evidence and limits |  |
| Approved demo language |  |
| Unresolved blockers |  |
