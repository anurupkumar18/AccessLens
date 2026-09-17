#!/usr/bin/env node
/**
 * Writes .env.local for the hosted shell and the extension from CloudFormation
 * outputs, so both builds bake in the same endpoints.
 *
 *   node infra/scripts/shell-env.mjs /tmp/outputs.json   # a `cdk deploy --outputs-file`
 *   node infra/scripts/shell-env.mjs --live               # the stacks as deployed right now
 *
 * `--live` exists because the hosted shell (dist-web) is itself an asset of
 * the AccessLensAuthoring stack: it has to be built before `cdk deploy`, from
 * the endpoints that already exist. On a brand-new account those are empty
 * until the second deploy.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const MAPPING = [
  ['VITE_ACCESSLENS_WS_URL', ['WebSocketUrl', 'LiveSessionUrl']],
  ['VITE_ACCESSLENS_API_URL', ['ApiUrl']],
  ['VITE_GOOGLE_CLIENT_ID', ['GoogleClientId']],
  ['VITE_ACCESSLENS_AI_URL', ['AiUrl']],
  ['VITE_ACCESSLENS_CHAT_URL', ['ChatUrl']],
  ['VITE_ACCESSLENS_ORB_ENDPOINT', ['OrbExplainUrl']],
  ['VITE_ACCESSLENS_ASSET_BASE_URL', ['DistributionUrl']],
  ['VITE_ACCESSLENS_CAPTIONS_ENDPOINT', ['CaptionsUrl']],
  ['VITE_ACCESSLENS_RECAP_ENDPOINT', ['RecapUrl']],
  ['VITE_ACCESSLENS_TRANSLATE_ENDPOINT', ['TranslateSpeakUrl']],
  ['VITE_ACCESSLENS_COURSE_MEDIA_ENDPOINT', ['CourseMediaUrl']],
];

/** @returns {Record<string, Record<string, string>>} stack name -> output key -> value */
function outputs(arg) {
  if (arg !== '--live') return JSON.parse(readFileSync(arg, 'utf8'));
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const raw = execFileSync('aws', ['cloudformation', 'describe-stacks', '--region', region, '--output', 'json'], { encoding: 'utf8' });
  const result = {};
  for (const stack of JSON.parse(raw).Stacks) {
    if (!stack.StackName.startsWith('AccessLens')) continue;
    result[stack.StackName] = Object.fromEntries((stack.Outputs ?? []).map(o => [o.OutputKey, o.OutputValue]));
  }
  return result;
}

const arg = process.argv[2];
if (!arg) { console.error('usage: shell-env.mjs <outputs.json | --live>'); process.exit(2); }
const stacks = outputs(arg);
const find = keys => keys.map(k => Object.values(stacks).map(s => s[k]).find(Boolean)).find(Boolean) ?? '';
const lines = MAPPING.map(([name, keys]) => `${name}=${find(keys)}`);
// The placeholder audience means the deploy ran without a client id; the shell must not bake it in.
const env = lines.map(l => l.startsWith('VITE_GOOGLE_CLIENT_ID=unconfigured.') ? 'VITE_GOOGLE_CLIENT_ID=' : l).join('\n') + '\n';
writeFileSync('.env.local', env, { mode: 0o600 });
process.stdout.write(env);
const missing = lines.filter(l => l.endsWith('=')).map(l => l.split('=')[0]);
if (missing.length) console.error(`::warning::no deployed endpoint yet for ${missing.join(', ')}`);
