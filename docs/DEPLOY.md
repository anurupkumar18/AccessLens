# Deploy AccessLens Authoring

This deployment is temporary. Everything created by this run is in the hackathon
AWS account and must be removed with `make destroy` when you finish.

## What the words mean

- A **stack** is one named CloudFormation group that creates and deletes the
  AccessLens resources together.
- A **bucket** is private cloud storage for files such as uploads, packs, and
  viewer assets.
- A **Lambda** is a small function AWS runs only when an API or deployment event
  invokes it.
- An **IAM role** is a set of AWS permissions that a Lambda temporarily uses.
- A **distribution** is a CloudFront HTTPS cache that serves static files near
  the browser.
- A **Google ID token** is the short-lived proof of a Google sign-in; the API
  accepts one from any instructor on the deployed allowlist (D12).

## 1. Open a terminal and choose the repository

Run these commands from the checkout:

```sh
cd /Users/jacoberard/school/Mind-Machine
aws sts get-caller-identity
```

Success looks like JSON containing account `087328706621` and a
`WSParticipantRole/Participant` ARN. If the command says `ExpiredToken`, sign in
again through Workshop Studio before continuing; do not deploy with expired
credentials.

The CDK command uses `us-east-1`, the region supported by this account. CDK is
already bootstrapped for the account; if a newly reset account says it is not
bootstrapped, run:

```sh
npx --yes aws-cdk@2 bootstrap aws://087328706621/us-east-1
```

Success ends with `Environment aws://087328706621/us-east-1 bootstrapped`.

## 2. Deploy the temporary stack

The API signs instructors in with Google, so the deploy needs two values,
in the environment or in `.env.local`:

```sh
export GOOGLE_CLIENT_ID='<web-client-id>.apps.googleusercontent.com'
export ACCESSLENS_INSTRUCTORS='you@example.edu,@cs.example.edu'
make deploy
```

`GOOGLE_CLIENT_ID` is an OAuth 2.0 client of type Web application from the
Google Cloud console (APIs & Services, Credentials), with authorized
JavaScript origins `http://localhost:5173` and the viewer URL below.
`ACCESSLENS_INSTRUCTORS` lists who may author: exact emails and/or whole
`@domains`, comma-separated. Anyone else who signs in gets HTTP 403.

This creates the `AccessLensAuthoring` stack, six private buckets, three
on-demand DynamoDB tables, the CloudFront distribution and the HTTP API with
its Google JWT authorizer. It also writes the untracked `.env.local` and
`.cdk-outputs.json` files, keeping both values above in `.env.local`.

Success ends with lines in this form (the values are different on each deploy):

```text
API URL: https://<api-id>.execute-api.us-east-1.amazonaws.com/
Viewer URL: https://<distribution-id>.cloudfront.net
Asset base URL: https://<distribution-id>.cloudfront.net
Google client id: <web-client-id>.apps.googleusercontent.com
Instructors: you@example.edu,@cs.example.edu
```

## 3. Confirm the viewer is served by CloudFront

Set the URL printed by `make deploy` in a shell variable and request it:

```sh
export VIEWER_URL='https://<distribution-id>.cloudfront.net'
curl --fail --silent --show-error -i "$VIEWER_URL/"
```

Success includes `HTTP/2 200` and the response body contains
`<title>AccessLens Viewer</title>`. The viewer bucket is private; the browser
reaches it through the distribution, not through a public S3 URL.

## 4. Confirm the protected API

Manual requests need a Google ID token for an account on
`ACCESSLENS_INSTRUCTORS`. The Google Cloud SDK issues one:

```sh
gcloud auth login   # once, as the instructor account
export API_URL='https://<api-id>.execute-api.us-east-1.amazonaws.com'
export ACCESSLENS_ID_TOKEN="$(gcloud auth print-identity-token)"
```

The token is valid for about an hour; rerun the last line when a request
starts answering 401.

With the token:

```sh
curl --fail-with-body --silent --show-error -i \
  -H "Authorization: Bearer $ACCESSLENS_ID_TOKEN" \
  "$API_URL/v1/health"
```

Success is HTTP 200 and JSON like:

```text
{"ok":true,"version":"v2","region":"us-east-1"}
```

Without a token:

```sh
curl --silent --show-error -i "$API_URL/v1/health"
```

Success is HTTP 401. API Gateway rejects the request before the health Lambda
runs. A valid Google sign-in for an account that is not on the instructor
list answers HTTP 403 with `"code":"not_an_instructor"` on any route below.

## 5. Upload a deck and queue a job

Create an upload URL:

```sh
UPLOAD_JSON="$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $ACCESSLENS_ID_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"filename":"HNSW_visualizations_slideshow.pdf","contentType":"application/pdf"}' \
  "$API_URL/v1/uploads")"
printf '%s\n' "$UPLOAD_JSON"
export UPLOAD_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).uploadId)' "$UPLOAD_JSON")"
export UPLOAD_URL="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).url)' "$UPLOAD_JSON")"
```

Success is JSON containing non-empty `uploadId`, an HTTPS `url`, and an
`expiresAt` timestamp.

Put the checked-in demo deck at the presigned URL:

```sh
curl --fail-with-body --silent --show-error -i -X PUT \
  -H 'content-type: application/pdf' \
  --upload-file packs/hnsw/HNSW_visualizations_slideshow.pdf \
  "$UPLOAD_URL"
```

Success is HTTP 200 from S3 with an empty response body. The deck goes into the
private `decks` bucket and expires after seven days.

Queue the V2 job:

```sh
JOB_JSON="$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $ACCESSLENS_ID_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"uploadId\":\"$UPLOAD_ID\",\"packId\":\"hnsw-explainer\",\"title\":\"HNSW explainer\"}" \
  "$API_URL/v1/jobs")"
printf '%s\n' "$JOB_JSON"
export JOB_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).jobId)' "$JOB_JSON")"
```

Success is HTTP 202 and JSON containing the new `jobId` and
`"status":"queued"`. Creating the job also starts one execution of the
`AccessLensAuthoring` Step Functions state machine, named after the job id.

Poll it:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $ACCESSLENS_ID_TOKEN" \
  "$API_URL/v1/jobs/$JOB_ID"
```

The `status` moves through `ingesting` (LibreOffice/Poppler render the deck
to PNGs and text), `describing` (the deck analyst writes `lesson.json`),
`visualizing` (every slide is described and given Polly audio, five slides at
a time), and settles at `review`. Measured on the eight-slide demo deck
(execution `9ec32fb5`, 2026-09-16): ingest 6 s, deck analyst 10 s, the
per-slide map 26 s, so `review` in about 42 s from `StartExecution`; the
first run of a fresh deploy adds a container cold start of a few seconds.
Review plus publish through the API took about 35 s more, and the
execution ended `SUCCEEDED` 77 s after it started. `slides` fills in as
each slide finishes. No visualization stages are
deployed yet, so every slide reports `visualizationStatus: "no-visual"` — a
clean absence, which is the spec's designed outcome for a slide with no
verified interactive.

To watch the execution itself:

```sh
aws stepfunctions describe-execution --region us-east-1 \
  --execution-arn "$(sed 's/stateMachine/execution/' <<<"$STATE_MACHINE_ARN"):$JOB_ID"
```

where `STATE_MACHINE_ARN` is the `StateMachineArn` output of `make deploy`.

`infra/bin/accesslens.ts` is one CDK app with two stacks: Part 4's
`AccessLensLiveSession` and this `AccessLensAuthoring`. `make deploy` and
`make destroy` name the authoring stack only, but CDK synthesizes the whole
app, so both scripts first build Part 4's Lambda bundle
(`services/live-session/dist`) exactly as its README requires.
`status` is `RUNNING` until the job reaches review, then stays `RUNNING`
while it waits for the instructor: the machine polls the job record every
few seconds and ends with `SUCCEEDED` once `POST /v1/jobs/{id}/review` and
`POST /v1/jobs/{id}/publish` have been called. The publish route is the
only writer of `packs/`, `media/` and `artifacts/`; the machine observes
the record flipping to `published` and does not publish anything itself.

Once the job is at `review`, the draft the instructor would see:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $ACCESSLENS_ID_TOKEN" \
  "$API_URL/v1/jobs/$JOB_ID/draft"
```

Success is JSON with one asset per slide, each carrying `regions` with
`shortDescription`, `plainLanguage`, and an `audioUri` under the job's
staging prefix. Nothing under `packs/`, `media/`, or `artifacts/` exists yet:
publishing is the instructor's decision, never the pipeline's.

The bounded all-in-one version of these checks is:

```sh
make smoke
```

It takes the ID token from `ACCESSLENS_ID_TOKEN` or, failing that, from
`gcloud auth print-identity-token`, then performs health, upload, PUT, job
creation, and bounded polls until the job leaves `queued`. It ends with
`Smoke complete.` and the status it last saw; `ingesting` or later means the
pipeline is running.

## 6. Remove everything

When finished, run:

```sh
make destroy
```

Success ends with:

```text
AccessLensAuthoring destroyed; temporary buckets, tables and the API are removed.
```

The command empties only the buckets named by this deployment's own CDK output,
then destroys the `AccessLensAuthoring` stack. It does not touch workshop
infrastructure or another stack. The CloudFormation delete removes the API
and its authorizer, tables, buckets, distribution, Lambdas, and IAM roles.

To prove that teardown was complete, deploy a second time:

```sh
make deploy
```

Success is a fresh set of `API URL`, `Viewer URL`, `Asset base URL`,
`Google client id` and `Instructors` lines. Run `make destroy` once more after that
verification; this AWS account and all resources in it are temporary.
