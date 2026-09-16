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
# The API takes a Google ID token (D12). Scripts get one from the Google Cloud
# SDK: `gcloud auth login` as an allowlisted instructor, then
# `gcloud auth print-identity-token`. ACCESSLENS_ID_TOKEN overrides that.
TOKEN="${ACCESSLENS_ID_TOKEN:-}"
if [[ -z "$TOKEN" ]] && command -v gcloud >/dev/null 2>&1; then
  TOKEN="$(gcloud auth print-identity-token 2>/dev/null || true)"
fi
: "${TOKEN:?No Google ID token. Run 'gcloud auth login' as an instructor on ACCESSLENS_INSTRUCTORS, or set ACCESSLENS_ID_TOKEN}"

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

printf '%s\n' '--- poll job until the pipeline picks it up ---'
for attempt in $(seq 1 10); do
  response="$(curl --fail-with-body --silent --show-error --max-time 15 \
    -H "Authorization: Bearer $TOKEN" \
    "$VITE_ACCESSLENS_API_URL/v1/jobs/$job_id")"
  printf 'poll %s: %s\n' "$attempt" "$response"
  status="$(node -e "const value=JSON.parse(process.argv[1]); process.stdout.write(value.status)" "$response")"
  if [[ "$status" != queued ]]; then break; fi
  sleep 3
done
printf 'Smoke complete. Last job status: %s (ingesting or later means the pipeline is running).\n' "$status"
