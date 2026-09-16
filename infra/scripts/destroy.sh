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

npx --yes cdk destroy --app "npx tsx infra/bin/app.ts" --force
rm -f .cdk-outputs.json
printf '%s\n' 'AccessLensAuthoring destroyed; temporary buckets and the bearer parameter are removed.'
