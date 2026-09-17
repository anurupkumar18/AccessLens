#!/usr/bin/env node
// Stack outputs -> the VITE_* variables the extension and the hosted shell
// (dist-web) are built with.
//
//   node infra/scripts/extension-env.mjs /tmp/outputs.json > .env.local
//   aws cloudformation describe-stacks --output json > s.json && node infra/scripts/extension-env.mjs s.json
//
// Accepts either `cdk deploy --outputs-file` JSON ({ Stack: { Key: value } })
// or `aws cloudformation describe-stacks` JSON, so CI can build dist-web from
// what is already deployed before synth (the authoring stack uploads dist-web)
// and again from fresh outputs afterwards.
import { readFileSync } from 'node:fs';

const parsed = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const outputs = Array.isArray(parsed.Stacks)
  ? Object.fromEntries(parsed.Stacks
    .filter(stack => stack.StackName.startsWith('AccessLens'))
    .map(stack => [stack.StackName, Object.fromEntries((stack.Outputs ?? []).map(o => [o.OutputKey, o.OutputValue]))]))
  : parsed;

const find = key => Object.values(outputs).map(stack => stack[key]).find(Boolean) ?? '';

const lines = [
  `VITE_ACCESSLENS_WS_URL=${find('WebSocketUrl') || find('LiveSessionUrl')}`,
  `VITE_ACCESSLENS_API_URL=${find('ApiUrl')}`,
  `VITE_GOOGLE_CLIENT_ID=${find('GoogleClientId')}`,
  `VITE_ACCESSLENS_ORB_ENDPOINT=${find('OrbExplainUrl')}`,
  `VITE_ACCESSLENS_ASSET_BASE_URL=${find('DistributionUrl')}`,
  `VITE_ACCESSLENS_CAPTIONS_ENDPOINT=${find('CaptionsUrl')}`,
  `VITE_ACCESSLENS_RECAP_ENDPOINT=${find('RecapUrl')}`,
  `VITE_ACCESSLENS_TRANSLATE_ENDPOINT=${find('TranslateSpeakUrl')}`,
  `VITE_ACCESSLENS_COURSE_MEDIA_ENDPOINT=${find('CourseMediaUrl')}`,
];
process.stdout.write(lines.join('\n') + '\n');
