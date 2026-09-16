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

# The course library's S3 Vectors bucket (spec section 9) holds one index per
# profile, created at runtime. CloudFormation cannot delete a bucket that
# still has indexes, so remove them first; the bucket itself is a stack
# resource and goes with the stack.
if [[ -f .cdk-outputs.json ]]; then
  vector_bucket="$(node --input-type=module -e "import { readFileSync } from 'node:fs'; const o=JSON.parse(readFileSync('.cdk-outputs.json')); const v=o[Object.keys(o)[0]]||{}; process.stdout.write(v.VectorBucketName||'')")"
  if [[ -n "$vector_bucket" ]]; then
    while IFS= read -r index; do
      [[ -z "$index" ]] && continue
      echo "Deleting vector index: $vector_bucket/$index"
      AWS_PAGER='' aws s3vectors delete-index --vector-bucket-name "$vector_bucket" --index-name "$index" --region us-east-1
    done < <(AWS_PAGER='' aws s3vectors list-indexes --vector-bucket-name "$vector_bucket" --region us-east-1 --query 'indexes[].indexName' --output text 2>/dev/null | tr '\t' '\n')
  fi
fi

# One CDK app carries both stacks, so synth needs Part 4's Lambda bundle
# even when only AccessLensAuthoring is deployed (services/live-session/README.md:
# "npm run build is not optional and not automatic").
(cd services/live-session && npm ci --no-audit --no-fund && npm run build)
npx --yes cdk destroy --app "npx tsx infra/bin/accesslens.ts" AccessLensAuthoring --force
rm -f .cdk-outputs.json
printf '%s\n' 'AccessLensAuthoring destroyed; temporary buckets, tables and the API are removed.'
