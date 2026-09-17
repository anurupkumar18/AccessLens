# AccessLens deployment

**Status: deployed.** All five parts have landed and the stacks are live. Run
`python3 scripts/deploy_preflight.py --aws` for the current answer rather than
trusting this sentence.

| What | Where |
| --- | --- |
| Install page and extension download | https://d3a2yoxehy0vb7.cloudfront.net |
| Reviewed pack assets | `https://d3a2yoxehy0vb7.cloudfront.net/packs/bio-cell-demo/` |
| Orb explanation endpoint | `AccessLensOrbExplain` Function URL (stack output) |
| Live session relay | `AccessLensLiveSession` (stack output) |

These die with the event account. Do not print them on anything permanent.

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

## Continuous deployment

`.github/workflows/deploy.yml` runs the full check suite and then deploys every
push to the integration branch, plus `workflow_dispatch` for manual runs.

Five people and their agents push here, so the workflow is built to be boring:

- **`concurrency` group per ref.** Two agents pushing a minute apart would
  otherwise race each other into CloudFormation, and the loser fails with an
  unhelpful conflict.
- **Deploy needs checks to pass.** `workflow_dispatch` carries a `skip_checks`
  input for demo emergencies; it is not available on push.
- **The extension is rebuilt *after* the stacks deploy**, against the endpoints
  they just produced. Vite inlines `import.meta.env` at build time, so a build
  made before the deploy cannot see the endpoint no matter what the environment
  says at run time. This is the step most likely to be got wrong by hand.
- **The packed extension is uploaded as a workflow artifact as well as to S3**,
  so a broken CloudFront does not cost you the build.

### One-time setup: GitHub deploy role

**Status on 2026-09-16: not done.** Every Deploy run so far (after PR #14 and
PR #19) stopped at "Check the deploy role is configured" because
`AWS_DEPLOY_ROLE_ARN` is unset. Only a repository admin can set it.

The workflow authenticates with GitHub OIDC rather than stored keys, because
Workshop Studio credentials expire within hours — a secret pasted in at 9am is
dead by lunchtime, and the failure lands on whoever pushes next rather than
whoever pasted it. After this setup nobody needs AWS keys to deploy again.

Written so an agent can run it top to bottom. The human supplies fresh
Workshop Studio credentials in the shell (never in a file in the repo, a
GitHub secret, or a chat message) and a `gh` login with admin on the repo.

```sh
# 0. Preconditions. Fresh Workshop Studio credentials exported in this shell:
#    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN,
#    AWS_DEFAULT_REGION=us-east-1.
aws sts get-caller-identity            # expect account 087328706621 (or the current event account)
gh api repos/anurupkumar18/Mind-Machine -q .permissions.admin   # must print true

# 1. Build every Lambda bundle. CDK validates all asset paths at synth time,
#    even when deploying a single stack, and services/*/dist is not committed.
for dir in services/*/; do npm ci --prefix "$dir" && npm run build --prefix "$dir"; done

# 2. Reuse the account's GitHub OIDC provider if one exists; an account may
#    hold only one per issuer, and creating a second fails EntityAlreadyExists.
OIDC_ARN=$(aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" \
  --output text)
[ "$OIDC_ARN" = "None" ] && OIDC_ARN=""

# 3. Deploy the role (from infra/, where cdk.json lives).
cd infra && npm ci
npx cdk deploy AccessLensGitHubDeploy --require-approval never \
  -c withDeployRole=true -c repository=anurupkumar18/Mind-Machine \
  ${OIDC_ARN:+-c oidcProviderArn=$OIDC_ARN} \
  --outputs-file /tmp/deploy-role.json
cd ..

# 4. Store the role ARN as a repository VARIABLE (not a secret).
ROLE_ARN=$(node -e 'console.log(require("/tmp/deploy-role.json").AccessLensGitHubDeploy.GitHubDeployRoleArn)')
gh variable set AWS_DEPLOY_ROLE_ARN --repo anurupkumar18/Mind-Machine --body "$ROLE_ARN"

# 5. Deploy the latest integration commit and watch it.
gh workflow run deploy.yml --repo anurupkumar18/Mind-Machine --ref accesslens-extension-ar-pivot
sleep 5
gh run watch --repo anurupkumar18/Mind-Machine \
  "$(gh run list --repo anurupkumar18/Mind-Machine --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

**Done when:** the run is green, its summary lists `WebSocketUrl`,
`OrbExplainUrl`, `CaptionsUrl`, `RecapUrl`, `TranslateSpeakUrl`,
`MediaAccessUrl` and `DistributionUrl`, and the `accesslens-extension` artifact
is attached. Every later push to `accesslens-extension-ar-pivot` deploys on its
own.

If it fails:

| Symptom | Cause and fix |
| --- | --- |
| `ExpiredToken` / `InvalidClientTokenId` in steps 0–3 | Workshop Studio credentials expired. Export fresh ones and rerun. |
| `EntityAlreadyExists` for the OIDC provider | Step 2 found nothing but a provider exists; pass its ARN with `-c oidcProviderArn=...`. |
| `AccessDenied` creating the OIDC provider or role | The workshop role cannot create IAM identity providers. Deploy by hand instead: `cd infra && npx cdk deploy --all --require-approval never` after step 1, then `npm run build` with the stack outputs in `.env.local`. |
| Workflow: `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The trust policy's `repo:` does not match. Redeploy step 3 with the exact `owner/repo`. |
| Workflow waits at "deploy" | The `aws` environment has required reviewers; approve the run in the Actions tab. |
| Workflow: `SSM parameter /cdk-bootstrap/hnb659fds/version not found` | The account was reset; bootstrap again (`npx cdk bootstrap aws://<account>/us-east-1`). |

The trust policy is scoped to the repository but open on ref, because every
agent works on its own branch and pinning to `main` would mean nothing deploys
until the final merge — exactly when nobody wants to discover the deploy is
broken. **Narrow the ref condition before this outlives the event.**
