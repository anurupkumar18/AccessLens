# AccessLens deployment

**Status: not deployable yet.** Parts 2, 3, and 4 have not contributed their
artifacts. Run `python3 scripts/deploy_preflight.py --aws` for the current
answer rather than trusting this sentence.

This document exists so that the deploy is not designed for the first time at
hour 46. It records what the account can actually do, in what order things must
happen, and which steps have no owner.

## The constraint that shapes everything

**The AWS account expires when the event does.** Workshop Studio credentials are
short-lived session tokens, and the account itself disappears at the end of the
event window. Two consequences:

1. Anything deployed is temporary by construction. That happens to suit the
   product — `PROJECT_CHARTER.md` requires temporary sessions and no recording —
   but it also means **nothing deployed survives the demo**. The recorded
   fallback in `DEMO_RUNBOOK.md` is not optional.
2. Credentials expire mid-event. Whoever deploys will need to re-export fresh
   ones from Workshop Studio, and `deploy_preflight.py --aws` will say
   `ExpiredToken` when that has happened.

## What the account can actually do

Probed on 2026-09-15 against account `087328706621`, role `WSParticipantRole`,
`us-east-1`. Every create needed by the `SYSTEM_DESIGN.md` §7 stack succeeded
and was cleaned up afterwards:

| Capability | Result |
| --- | --- |
| IAM: create role | permitted (CDK bootstrap needs several) |
| DynamoDB: create table | permitted |
| API Gateway v2: create WebSocket API | permitted |
| S3: create bucket | permitted |
| CloudFormation: create stack | permitted |
| CDK bootstrap | done — `CDKToolkit`, version 32 |

So the planned architecture is deployable here. Two caveats found:

- **CDK is now bootstrapped** (done 2026-09-15, thread T-21 closed).
  `CDKToolkit` is at bootstrap version 32 with staging bucket
  `cdk-hnb659fds-assets-087328706621-us-east-1`. `cdk deploy` will work without
  further setup. Note it was bootstrapped with CDK's default
  `AdministratorAccess` execution policy — normal for a throwaway event account,
  and worth scoping with `--cloudformation-execution-policies` in anything that
  outlives it.
- A pre-provisioned Lambda named `WSConcurrencyCurtailer-DO-NOT-USE` exists in
  the account. The workshop appears to throttle concurrency; do not assume
  unlimited Lambda scaling during the demo, and do not touch that function.

## Order of operations

Nothing here can be parallelised away — each step needs the one before it.

1. **Preflight.** `python3 scripts/deploy_preflight.py --aws`. Fix anything
   marked `✗` before continuing. `!` items are warnings you should understand
   rather than ignore.
2. **Bootstrap CDK** — already done for this account. Only needed again if the
   account is reset: `npx --yes aws-cdk@2 bootstrap aws://<account>/us-east-1`.
3. **Deploy Part 4's stack** — API Gateway WebSocket API, Lambda handlers,
   DynamoDB session table with TTL. Part 4 owns the command; it belongs in
   `infra/` per `PARALLEL_WORKSTREAMS.md`.
4. **Record the endpoint.** Copy the deployed `wss://` URL into `.env.local` as
   `VITE_ACCESSLENS_WS_URL`. The names are frozen in `.env.example`; do not
   invent new ones.
5. **Publish the Access Pack** if assets are to be served rather than bundled:
   upload `packages/access-packs/bio-cell-demo/` to S3 and set
   `VITE_ACCESSLENS_ASSET_BASE_URL`. The pack is checked in and the extension
   can read it locally, so this is optional for the demo and is the first thing
   to drop if time is short.
6. **Rebuild the extension** with those values present: `npm run build`. Vite
   inlines `import.meta.env` at build time, so a build made before step 4 will
   not see the endpoint no matter what the environment says at run time.
7. **Load `dist/` unpacked** in each browser profile — one instructor, two
   students.
8. **Rehearse.** `DEMO_RUNBOOK.md` has the three-minute script and the fallback
   replays.

## Verifying a deploy without the extension

Part 5's fixtures drive the relay directly, so the transport can be proven
before any UI is wired to it:

```sh
python3 packages/access-packs/bio-cell-demo/tools/simulate_events.py \
  --scenario happy-path --stream
```

Every event is valid against `packages/contracts/`, so anything the relay
rejects from this stream is a relay bug. `fixtures/invalid/` holds ten events
that must each be rejected — six fail on shape alone, four need the relay to
consult the reviewed pack or per-session stream state. See
`docs/PART5_CONTRACT_CONFORMANCE.md`.

## Teardown

The account expires on its own, but leaving it clean is polite and makes a
second rehearsal reproducible:

```sh
npx cdk destroy            # removes Part 4's stack
aws s3 rb s3://<bucket> --force   # only if step 5 was done
```

Do not delete the four pre-provisioned stacks (`kiro-rdp`, `idc-kiro`,
`vscode-server`, `aws-generative-ai-hackathon`) or the workshop Lambdas. They
are the event's own infrastructure.

## Steps that currently have no owner

- **T-13** — merging the integration branch to `master` at the end.
- **T-07** — CI still does not run on the integration branch on push.

Each is small. Each is also exactly the kind of step that is nobody's job right
up until it is on the critical path.
