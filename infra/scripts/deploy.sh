#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# CloudFront serves the real viewer -- the page whose ?mode=harness check
# gates every artifact -- so it is built fresh here rather than deployed from
# whatever dist/ happens to be checked in.
npx vite build --config apps/viewer/vite.config.ts

npx --yes cdk deploy --app "npx tsx infra/bin/app.ts" --require-approval never --outputs-file .cdk-outputs.json

node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const output = JSON.parse(readFileSync('.cdk-outputs.json', 'utf8'));
const stackName = Object.keys(output)[0];
if (!stackName) throw new Error('CDK returned no stack outputs');
const values = output[stackName];
const required = ['ApiUrl', 'ViewerUrl', 'AssetBaseUrl', 'BearerToken', 'TokenParameterName'];
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
const env = [...preserved.entries()].map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
writeFileSync('.env.local', env, { mode: 0o600 });
console.log(`API URL: ${values.ApiUrl}`);
console.log(`Viewer URL: ${values.ViewerUrl}`);
console.log(`Asset base URL: ${values.AssetBaseUrl}`);
console.log(`Bearer token: ${values.BearerToken}`);
console.log(`Token parameter: ${values.TokenParameterName}`);
NODE
