#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
if [[ ! -f .env.local ]]; then
  echo "No .env.local found. Run make deploy first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a
: "${VITE_ACCESSLENS_API_URL:?VITE_ACCESSLENS_API_URL is missing from .env.local}"
TOKEN="${ACCESSLENS_API_TOKEN:-${BEARER_TOKEN:-}}"
if [[ -z "$TOKEN" && -f .cdk-outputs.json ]]; then
  TOKEN="$(node --input-type=module -e "const o=JSON.parse(require('fs').readFileSync('.cdk-outputs.json')); const v=o[Object.keys(o)[0]]; process.stdout.write(v.BearerToken || '')")"
fi
: "${TOKEN:?Bearer token is missing; run make deploy and keep the printed token in ACCESSLENS_API_TOKEN or .cdk-outputs.json}"

printf '%s\n' '--- health ---'
curl --fail-with-body --silent --show-error --max-time 15 \
  -H "Authorization: Bearer $TOKEN" \
  "$VITE_ACCESSLENS_API_URL/v1/health"
printf '\n'

printf '%s\n' '--- create upload ---'
upload_json="$(curl --fail-with-body --silent --show-error --max-time 15 \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"filename":"HNSW_visualizations_slideshow.pdf","contentType":"application/pdf"}' \
  "$VITE_ACCESSLENS_API_URL/v1/uploads")"
printf '%s\n' "$upload_json"

upload_id="$(node -e "const value=JSON.parse(process.argv[1]); process.stdout.write(value.uploadId)" "$upload_json")"
upload_url="$(node -e "const value=JSON.parse(process.argv[1]); process.stdout.write(value.url)" "$upload_json")"
printf '%s\n' '--- upload deck ---'
curl --fail-with-body --silent --show-error --max-time 120 -X PUT \
  -H 'content-type: application/pdf' \
  --upload-file packs/hnsw/HNSW_visualizations_slideshow.pdf \
  "$upload_url"
printf '\n'

printf '%s\n' '--- create job ---'
job_json="$(curl --fail-with-body --silent --show-error --max-time 15 \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"uploadId\":\"$upload_id\",\"packId\":\"hnsw-explainer\",\"title\":\"HNSW explainer\"}" \
  "$VITE_ACCESSLENS_API_URL/v1/jobs")"
printf '%s\n' "$job_json"
job_id="$(node -e "const value=JSON.parse(process.argv[1]); process.stdout.write(value.jobId)" "$job_json")"

printf '%s\n' '--- poll job (V2 remains queued until pipeline lanes land) ---'
for attempt in $(seq 1 5); do
  response="$(curl --fail-with-body --silent --show-error --max-time 15 \
    -H "Authorization: Bearer $TOKEN" \
    "$VITE_ACCESSLENS_API_URL/v1/jobs/$job_id")"
  printf 'poll %s: %s\n' "$attempt" "$response"
  status="$(node -e "const value=JSON.parse(process.argv[1]); process.stdout.write(value.status)" "$response")"
  if [[ "$status" != queued ]]; then break; fi
  sleep 2
done
printf '%s\n' 'Smoke complete. A queued status is expected until the V3/V4 pipeline lanes are deployed.'
