#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# Instructors sign in with Google (D12). The stack needs the OAuth web client
# id the sign-in button uses and the list of instructor emails / @domains that
# may author. Both come from the environment or from .env.local, which this
# script rewrites below and keeps them in.
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi
: "${GOOGLE_CLIENT_ID:?Set GOOGLE_CLIENT_ID to the OAuth web client id from Google Cloud console (Credentials > OAuth client ID > Web application)}"
: "${ACCESSLENS_INSTRUCTORS:?Set ACCESSLENS_INSTRUCTORS to a comma-separated list of instructor emails and/or @domains}"

# CloudFront serves the real viewer -- the page whose ?mode=harness check
# gates every artifact -- so it is built fresh here rather than deployed from
# whatever dist/ happens to be checked in.
npx vite build --config apps/viewer/vite.config.ts

# One CDK app carries both stacks, so synth needs Part 4's Lambda bundle
# even when only AccessLensAuthoring is deployed (services/live-session/README.md:
# "npm run build is not optional and not automatic").
(cd services/live-session && npm ci --no-audit --no-fund && npm run build)
npx --yes cdk deploy --app "npx tsx infra/bin/accesslens.ts" AccessLensAuthoring --require-approval never --outputs-file .cdk-outputs.json \
  -c "googleClientId=$GOOGLE_CLIENT_ID" -c "instructorAllowlist=$ACCESSLENS_INSTRUCTORS"

node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const output = JSON.parse(readFileSync('.cdk-outputs.json', 'utf8'));
const stackName = Object.keys(output)[0];
if (!stackName) throw new Error('CDK returned no stack outputs');
const values = output[stackName];
const required = ['ApiUrl', 'ViewerUrl', 'AssetBaseUrl', 'GoogleClientId', 'InstructorAllowlist'];
for (const name of required) if (!values[name]) throw new Error(`Missing CDK output ${name}`);
const existing = readFileSync('.env.example', 'utf8');
const preserved = new Map();
for (const line of existing.split(/\r?\n/u)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
  if (match) preserved.set(match[1], match[2]);
}
preserved.set('VITE_ACCESSLENS_API_URL', values.ApiUrl);
preserved.set('VITE_ACCESSLENS_VIEWER_URL', values.ViewerUrl);
preserved.set('VITE_ACCESSLENS_ASSET_BASE_URL', values.AssetBaseUrl);
preserved.set('VITE_GOOGLE_CLIENT_ID', values.GoogleClientId);
preserved.set('GOOGLE_CLIENT_ID', values.GoogleClientId);
preserved.set('ACCESSLENS_INSTRUCTORS', values.InstructorAllowlist);
const env = [...preserved.entries()].map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
writeFileSync('.env.local', env, { mode: 0o600 });
console.log(`API URL: ${values.ApiUrl}`);
console.log(`Viewer URL: ${values.ViewerUrl}`);
console.log(`Asset base URL: ${values.AssetBaseUrl}`);
console.log(`Google client id: ${values.GoogleClientId}`);
console.log(`Instructors: ${values.InstructorAllowlist}`);
NODE
