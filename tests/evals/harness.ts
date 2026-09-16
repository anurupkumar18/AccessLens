// Running a real agent stage against a real slide, and scoring what came back.
//
// These evaluations call Bedrock. They are opt-in (`RUN_LLM_EVALS=1`) because
// `make check` must stay fast, offline, and free -- but they are not optional
// to the product. Every other test in this repository proves that our code
// does what we meant; only these prove that the *model* produces the resource
// the spec specified, which is the half of an LLM pipeline that unit tests
// cannot reach.
//
// Two rules shape the design:
//
//   1. Drive the real code path. `runAgentStage` with the shipped prompt file
//      and the shipped Zod schema, not a test-only replica. A prompt that
//      works in an eval harness and not in the Lambda has proved nothing.
//   2. Report rates, do not only assert booleans. "Nine of ten slides needed
//      no edit" is a number an instructor can act on; "the test passed" is not.
//      Thresholds are deliberately loose, because a tight threshold on a
//      stochastic stage is a flaky test that gets deleted.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Violation } from './properties';
import { promptDir, type AgentRole, AGENT_ROLES } from '../../services/shared/agentStage';

export const EVALS_ENABLED = process.env.RUN_LLM_EVALS === '1';

/** Prompts are authored in their own lane; an eval with no prompt is not a failure, it is not yet runnable. */
export function promptsPresent(): AgentRole[] {
  const dir = promptDir();
  return AGENT_ROLES.filter(role => existsSync(join(dir, `${role}.md`)));
}

export function pngAsBase64(path: string): string {
  return readFileSync(path).toString('base64');
}

export interface CaseResult {
  caseId: string;
  /** Subject, so held-out subjects can be reported separately from tuned ones. */
  subject: string;
  heldOut: boolean;
  attempts: number;
  violations: Violation[];
  /** Stage-specific numbers worth reporting, e.g. region count or plan decision. */
  facts: Record<string, string | number | boolean>;
  error?: string;
}

export interface StageReport {
  role: AgentRole;
  model: string;
  startedAt: string;
  cases: CaseResult[];
}

/**
 * A prompt tuned until every slide in one deck comes out perfect has learned
 * that deck. The spec's anti-pattern section says to hold at least two
 * subjects out of prompt iteration and report their hit rate separately, so
 * the report separates them rather than averaging the evidence away.
 */
export const HELD_OUT_SUBJECTS = ['biology', 'economics'];

export function summariseStage(report: StageReport) {
  const total = report.cases.length;
  const ran = report.cases.filter(c => !c.error);
  const clean = ran.filter(c => c.violations.length === 0);
  const heldOut = ran.filter(c => c.heldOut);
  const heldOutClean = heldOut.filter(c => c.violations.length === 0);
  const tuned = ran.filter(c => !c.heldOut);
  const tunedClean = tuned.filter(c => c.violations.length === 0);

  const rate = (n: number, d: number) => (d === 0 ? 'n/a' : `${n}/${d} (${Math.round((100 * n) / d)}%)`);

  return {
    total,
    errored: total - ran.length,
    cleanRate: rate(clean.length, ran.length),
    heldOutCleanRate: rate(heldOutClean.length, heldOut.length),
    tunedCleanRate: rate(tunedClean.length, tuned.length),
    meanAttempts: ran.length ? (ran.reduce((s, c) => s + c.attempts, 0) / ran.length).toFixed(2) : 'n/a',
    violationsByRule: countRules(ran.flatMap(c => c.violations)),
  };
}

export function countRules(violations: Violation[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of violations) out[v.rule] = (out[v.rule] ?? 0) + 1;
  return out;
}

/**
 * Write the report to disk. A stochastic evaluation whose output scrolls past
 * in a terminal cannot be compared against last week's, which is how a slow
 * regression in a prompt goes unnoticed until a demo.
 */
export function writeReport(report: StageReport): string {
  const dir = process.env.EVAL_REPORT_DIR ?? join(process.cwd(), 'tests', 'evals', 'reports');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${report.role}.json`);
  writeFileSync(path, JSON.stringify({ ...report, summary: summariseStage(report) }, null, 2) + '\n');
  return path;
}

export function renderStageTable(report: StageReport): string {
  const s = summariseStage(report);
  const lines = [
    `## ${report.role} (${report.model})`,
    ``,
    `| metric | value |`,
    `| --- | --- |`,
    `| cases | ${s.total} |`,
    `| errored | ${s.errored} |`,
    `| clean, all subjects | ${s.cleanRate} |`,
    `| clean, held-out subjects | ${s.heldOutCleanRate} |`,
    `| clean, tuned subjects | ${s.tunedCleanRate} |`,
    `| mean attempts to valid output | ${s.meanAttempts} |`,
  ];
  const rules = Object.entries(s.violationsByRule).sort((a, b) => b[1] - a[1]);
  if (rules.length) {
    lines.push(``, `Violations by rule: ${rules.map(([r, n]) => `${r} x${n}`).join(', ')}`);
  }
  for (const c of report.cases.filter(c => c.violations.length || c.error)) {
    lines.push(``, `- \`${c.caseId}\` (${c.subject}${c.heldOut ? ', held out' : ''}): ${c.error ?? c.violations.map(v => v.rule).join(', ')}`);
  }
  return lines.join('\n');
}
