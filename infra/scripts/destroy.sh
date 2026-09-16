#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .cdk-outputs.json ]]; then
  while IFS= read -r bucket; do
    [[ -z "$bucket" ]] && continue
    echo "Emptying temporary bucket: $bucket"
    AWS_PAGER='' aws s3 rm "s3://$bucket" --recursive --region us-east-1
  done < <(node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const values = JSON.parse(readFileSync('.cdk-outputs.json', 'utf8'));
const stack = values[Object.keys(values)[0]] ?? {};
for (const name of ['DecksBucketName', 'CatalogBucketName', 'PacksBucketName', 'ArtifactsBucketName', 'LibraryBucketName', 'ViewerBucketName']) {
  if (stack[name]) console.log(stack[name]);
}
NODE
  )
fi

# One CDK app carries both stacks, so synth needs Part 4's Lambda bundle
# even when only AccessLensAuthoring is deployed (services/live-session/README.md:
# "npm run build is not optional and not automatic").
(cd services/live-session && npm ci --no-audit --no-fund && npm run build)
npx --yes cdk destroy --app "npx tsx infra/bin/accesslens.ts" AccessLensAuthoring --force
rm -f .cdk-outputs.json
printf '%s\n' 'AccessLensAuthoring destroyed; temporary buckets, tables and the API are removed.'
