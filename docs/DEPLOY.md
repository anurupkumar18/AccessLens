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
- **Parameter Store** is AWS Systems Manager's encrypted key/value store; this
  deployment keeps the bearer token there rather than in source code.

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

```sh
make deploy
```

This creates the `AccessLensAuthoring` stack, six private buckets, three
on-demand DynamoDB tables, the CloudFront distribution, the HTTP API, and the
bearer-token parameter. It also writes the untracked `.env.local` and
`.cdk-outputs.json` files.

Success ends with lines in this form (the values are different on each deploy):

```text
API URL: https://<api-id>.execute-api.us-east-1.amazonaws.com/
Viewer URL: https://<distribution-id>.cloudfront.net
Asset base URL: https://<distribution-id>.cloudfront.net
Bearer token: <base64url-token>
Token parameter: /accesslens/authoring/api-token
```

Copy the `Bearer token` value if you want to make manual requests. `make smoke`
can read it automatically from `.cdk-outputs.json`.

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

Set the printed values in shell variables:

```sh
export API_URL='https://<api-id>.execute-api.us-east-1.amazonaws.com'
export ACCESSLENS_API_TOKEN='<base64url-token>'
```

With the token:

```sh
curl --fail-with-body --silent --show-error -i \
  -H "Authorization: Bearer $ACCESSLENS_API_TOKEN" \
  "$API_URL/v1/health"
```

Success is HTTP 200 and JSON like:

```text
{"ok":true,"version":"v2","region":"us-east-1"}
```

Without the token:

```sh
curl --silent --show-error -i "$API_URL/v1/health"
```

Success is HTTP 401. API Gateway rejects the request before the health Lambda
runs.

## 5. Upload a deck and queue a job

Create an upload URL:

```sh
UPLOAD_JSON="$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $ACCESSLENS_API_TOKEN" \
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
  -H "Authorization: Bearer $ACCESSLENS_API_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"uploadId\":\"$UPLOAD_ID\",\"packId\":\"hnsw-explainer\",\"title\":\"HNSW explainer\"}" \
  "$API_URL/v1/jobs")"
printf '%s\n' "$JOB_JSON"
export JOB_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).jobId)' "$JOB_JSON")"
```

Success is HTTP 202 and JSON containing the new `jobId` and
`"status":"queued"`. V2 records the job but intentionally does not start the
pipeline; later milestones replace that one function body.

Poll it once:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $ACCESSLENS_API_TOKEN" \
  "$API_URL/v1/jobs/$JOB_ID"
```

Success is JSON with the same `jobId`, `packId`, an empty `slides` array, and
`"status":"queued"`.

The bounded all-in-one version of these checks is:

```sh
make smoke
```

It performs health, upload, PUT, job creation, and five bounded polls. It ends
with `Smoke complete. A queued status is expected until the V3/V4 pipeline lanes are deployed.`

## 6. Remove everything

When finished, run:

```sh
make destroy
```

Success ends with:

```text
AccessLensAuthoring destroyed; temporary buckets and the bearer parameter are removed.
```

The command empties only the buckets named by this deployment's own CDK output,
then destroys the `AccessLensAuthoring` stack. It does not touch workshop
infrastructure or another stack. The CloudFormation delete removes the
Parameter Store token, API, tables, buckets, distribution, Lambdas, and IAM
roles.

To prove that teardown was complete, deploy a second time:

```sh
make deploy
```

Success is a fresh set of `API URL`, `Viewer URL`, `Asset base URL`, `Bearer
token`, and `Token parameter` lines. Run `make destroy` once more after that
verification; this AWS account and all resources in it are temporary.
