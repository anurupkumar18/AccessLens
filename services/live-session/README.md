# Part 4 — AWS temporary session service and real-time transport

The relay that carries semantic events from one instructor to many students, and
refuses everything else. Implementation-plan tasks A6, A7, A8.

**Deployed and verified** against the hackathon account on 2026-09-15:
`wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo`. That endpoint lives
in a temporary Workshop Studio account and **will disappear when the event ends**
— see `docs/AWS_ACCESS_VERIFICATION.md` §1. Redeploy for anything beyond the
hackathon.

## What is here

| Path | What it is |
| --- | --- |
| `src/rules.ts` | Server-side validation. Rule names match Part 5's `reference_event_check.py` exactly |
| `src/capability.ts` | HMAC-signed, short-lived, role-scoped capabilities. No identity |
| `src/store.ts` | DynamoDB session and connection state, TTL enforced on every read |
| `src/relay.ts` | The decisions: create, join, resume, publish, close, disconnect |
| `src/handler.ts` | API Gateway WebSocket adapter. Thin |
| `src/log.ts` | Redacted logging. Lesson content cannot reach CloudWatch |
| `src/client/webSocketSessionClient.ts` | The real `SessionClient` for Parts 2 and 3 |
| `../../infra/` | CDK stack: WebSocket API, Lambda, two DynamoDB tables, log group, secret |

## Running the checks

```sh
cd services/live-session
npm install
npm run check      # typecheck + 49 unit tests + bundle
```

The unit suite needs no AWS credentials and no network. It includes a parity test
that runs Part 5's Python reference over the same fixtures and fails if the two
validators disagree about a single event, so `python3` must be on `PATH`.

## Deploying

```sh
cd services/live-session && npm install && npm run build   # produces dist/index.mjs
cd ../../infra && npm install
export AWS_PROFILE=hackathon          # credentials per docs/AWS_ACCESS_VERIFICATION.md
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1
npx cdk deploy --require-approval never
```

`npm run build` is not optional and not automatic: the stack deploys
`services/live-session/dist/` as a prebuilt asset rather than letting CDK bundle
implicitly. **Deploying without rebuilding ships the previous code**, which is
the one foot-gun in this setup. The trade was deliberate — CDK's `NodejsFunction`
shells out to esbuild from the repository root, where adding it would mean
editing Part 1's `package.json`.

Deployment prints `WebSocketUrl`. That value is `VITE_ACCESSLENS_WS_URL` in
`.env.local` — the name Part 1 froze in `.env.example`.

To tear it down: `cd infra && npx cdk destroy`. Every resource is
`RemovalPolicy.DESTROY`, so nothing survives.

## Verifying a deployment

```sh
cd services/live-session
node scripts/integration-test.mjs wss://<api-id>.execute-api.us-east-1.amazonaws.com/demo
```

This is Part 4's first "Done when" as an executable check: one instructor drives
two students through the reviewed happy path over the real endpoint, then four
refusals are confirmed. It uses a fresh session id per run, because the relay
refuses a replayed sequence and a reused id would fail for the wrong reason.

Last run: 19 events, both students in order, instructor not echoed, all five
refusal checks held.

## The protocol

Messages are Part 1's frozen `SessionMessageSchema`: `create`, `join`, `close`,
`event`. The relay answers over the same socket:

| Reply | When |
| --- | --- |
| `{kind: 'capability', capability}` | after `create` or `join` |
| `{kind: 'accepted'}` | an event was validated and relayed |
| `{kind: 'rejected', rules: [...]}` | an event was refused, with the rule names |
| `{kind: 'closed'}` | the session is closed |
| `{kind: 'error', reason}` | everything else |
| `{kind: 'event', event}` | a relayed event, or reconnect catch-up |

Replies go back through the management API rather than as the Lambda's HTTP
response, because a WebSocket API does not forward a return body to the client
without separately configured route responses. One delivery channel is easier to
keep correct than two.

**Reconnecting** carries the capability in the `$connect` query string
(`?sessionId=…&capability=<base64url JSON>`). `SessionMessageSchema` is
`.strict()`, so it cannot ride on a message — and a brand-new connection is
otherwise indistinguishable from a stranger's.

## Decisions worth knowing

**Every event type is instructor-only.** A student connection publishes nothing.
A capability's role is signed, so editing `student` to `instructor` invalidates
it.

**Catch-up is latest state, never a replay.** One view-bearing event is kept per
session. This is both what the `reconnect-latest-state` fixture requires and the
reason the relay holds no lesson history.

**Ordering is decided twice.** `checkEvent` compares against the last sequence
the relay saw; `advanceSequence` then re-checks it in a DynamoDB condition
expression. Two events arriving together both pass the first and only one passes
the second.

**Expiry is enforced on read.** DynamoDB TTL deletes asynchronously — up to 48
hours late — so every read applies `isLive()` and reports an expired record as
absent.

**The relay never receives lesson prose.** `scripts/build-pack-index.mjs` strips
the pack to identifiers before bundling, so descriptions and plain-language text
are not in the deployment artifact at all. Verified in real CloudWatch output
after the integration run: of 182 log lines, the only occurrence of `frameData`
was the rule name explaining a refusal, and no region id, caption, pointer, or
base64 payload appeared anywhere.

## Threads this closed, and one it did not

- **T-15** (first sequence number) — pinned to 1, matching Part 5's simulator and
  the Python reference. `sequence: 0` is refused as
  `sequence-not-a-positive-integer`.
- **T-19** (stale `packVersion` invisible to schema validation) — the session
  records its pack version at create time and the relay compares every event
  against it, so student renderers do not each need to.
- **T-20** (write path unproven) — closed by deploying.

Still open and **not** Part 4's to close: **T-05**, the pack schema forbidding
`arScene`. The relay validates hotspots against `arScene` in the pack, so it
works today, but the shared JSON Schema would reject the very pack it reads.

## What is not built

- No authorizer on `$connect` for the initial connection. Anyone who can reach
  the endpoint can create a session; the session id is the only secret. Fine for
  a reviewed demo pack, not fine for real course content.
- `caption.appended` carries no caption (**T-16**, Part 1's contract gap). The
  relay allows the field so it is not the blocker when T-16 closes.
- No metrics or alarms beyond the default Lambda ones.
- The capability secret does not rotate.
