# Deployment readiness and AWS account capability

## Goal

Make the demo deployable the moment the five parts are done, rather than
designing the deploy for the first time near feature freeze.

## Changed files

- Added `scripts/deploy_preflight.py` and a `make deploy-preflight` target.
- Added `docs/DEPLOYMENT.md`.
- Added thread T-21 to `docs/CONTEXT_RELAY.md`.

## Findings

The AWS account was probed rather than assumed. Account `087328706621`, role
`WSParticipantRole`, `us-east-1`. Every create the `SYSTEM_DESIGN.md` section 7
stack needs succeeded — IAM role, DynamoDB table, API Gateway v2 WebSocket API,
S3 bucket, CloudFormation stack — each created and then deleted. So the planned
architecture is deployable here, which was not previously established by anyone.

Two things that were not: **CDK is not bootstrapped**, so `npx cdk bootstrap`
must be run once before any `cdk deploy` works, and it appears in nobody's task
list. That is T-21. And a pre-provisioned Lambda named
`WSConcurrencyCurtailer-DO-NOT-USE` suggests the workshop throttles concurrency,
so Lambda scaling should not be assumed during the demo.

The larger constraint is that the account expires when the event does, and the
credentials are short-lived session tokens that expire sooner. Nothing deployed
survives the demo, which makes the recorded fallback in `DEMO_RUNBOOK.md`
load-bearing rather than a nicety. Whoever deploys will need to re-export
credentials from Workshop Studio mid-event.

`deploy_preflight.py` reports per part whether that part's deployable artifact
exists, plus environment and account checks that belong to nobody. Today it
reports five blocking gaps across Parts 2, 3, and 4, which is the honest state
while those parts are being built. Part 2's shows as missing only because PR #8
has not merged.

## Guardrails preserved

The preflight is deliberately shallow about other people's code: it checks that
a part's deployable artifact exists and that its own checks pass, not how it is
written. Judging a teammate's implementation from a script is review's job, and
a preflight that fails on style would get ignored on the day it mattered.

## Validation evidence

- All five AWS creates verified and cleaned up; only a DynamoDB table was left
  in `DELETING`, which completes on its own.
- `deploy_preflight.py` exercised both with and without `--aws`.
- `make check` green.

## Blocker

T-21 (CDK bootstrap) has no owner. Parts 2, 3, and 4 have not contributed
deployable artifacts; Parts 3 and 4 have no owner at all.

## Owner

Kunj Rathod, Part 5, acting cross-cutting.

## Next action

Someone runs `npx cdk bootstrap` once. Whoever takes Part 4 reads
`docs/DEPLOYMENT.md` before writing the stack, since the account's constraints
are already recorded there.
