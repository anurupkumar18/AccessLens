import { z } from 'zod';
import { ArtifactManifestSchema, type ArtifactManifest } from '../../apps/extension/src/shared/contracts';
import { CritiqueSchema, type VizPlan } from '../shared/jobs';
import { verifyReferences, type Excerpt, type VerifiedReference } from '../shared/references';
import { runAgentStage, type MessagesClient } from '../shared/agentStage';
import { checkArtifactHtml, checkArtifactManifest, formatViolations, type Violation } from '../../tests/evals/properties';
import type { ArtifactDirectory } from './artifact';

/** The viewer harness seam. The local and Lambda implementations share this shape. */
export interface RenderCheck {
  (input: { artifactDir: string; parameters: Record<string, unknown> }): Promise<{
    ok: boolean;
    consoleErrors: string[];
    unhandledRejections: string[];
    screenshotPath?: string;
  }>;
}

export interface CriticInput {
  plan: VizPlan;
  artifact: ArtifactDirectory;
  /** Local staging directory or an S3-mounted artifact directory. */
  artifactDir: string;
  jobId: string;
  slideId: string;
  excerpts: readonly Excerpt[];
  /** Optional reviewed slide context for the fidelity prompt. */
  slideText?: string;
  slideTitle?: string;
  slideDescription?: string;
  lessonContext?: string;
}

export interface CriticDependencies {
  render: RenderCheck;
  client?: MessagesClient;
  promptDirectory?: string;
}

export interface CritiqueResult extends z.infer<typeof CritiqueSchema> {
  screenshotPath?: string;
  deterministicProblems: string[];
  verifiedReferences: VerifiedReference[];
}

export interface RepairableCritique {
  status: 'repair';
  problems: string[];
  critique: CritiqueResult;
}

export interface ReadyVisualization {
  status: 'ready';
  artifact: ArtifactDirectory;
  critique: CritiqueResult;
  screenshotPath: string;
}

export interface NoVisualization {
  status: 'no-visual';
  reason: string;
  lastCritique?: CritiqueResult;
}

export type CritiqueLoopResult = ReadyVisualization | NoVisualization;

function artifactViolations(input: CriticInput): Violation[] {
  // These are intentionally run in this order. `checkArtifactManifest` parses
  // the manifest and checks blessed libraries before any HTML/render operation.
  return [
    ...checkArtifactManifest(input.artifact.manifest, `${input.jobId}/${input.slideId}`),
    ...checkArtifactHtml(input.artifact.indexHtml, `${input.jobId}/${input.slideId}`),
  ];
}

function renderProblems(result: Awaited<ReturnType<RenderCheck>>): string[] {
  const problems: string[] = [];
  if (!result.ok) problems.push('Harness render failed.');
  for (const error of result.consoleErrors) problems.push(`Harness console error: ${error}`);
  for (const rejection of result.unhandledRejections) problems.push(`Harness unhandled rejection: ${rejection}`);
  if (!result.screenshotPath && result.ok) problems.push('Harness did not produce a screenshot.');
  return problems;
}

function excerptText(excerpt: Excerpt): string {
  return JSON.stringify({
    chunkId: excerpt.chunkId,
    docId: excerpt.docId,
    title: excerpt.title,
    page: excerpt.page,
    score: excerpt.score,
    text: excerpt.text,
  });
}

function criticUserText(input: CriticInput, screenshotPath: string): string {
  return [
    'Judge whether this visualization faithfully represents what the slide teaches.',
    '',
    `jobId: ${input.jobId}`,
    `slideId: ${input.slideId}`,
    `slide title: ${input.slideTitle ?? '(not supplied)'}`,
    `slide text: ${input.slideText ?? '(not supplied)'}`,
    `slide primary-region description: ${input.slideDescription ?? '(not supplied)'}`,
    `lesson context: ${input.lessonContext ?? '(not supplied)'}`,
    '',
    'visualization plan:',
    JSON.stringify(input.plan),
    '',
    'artifact manifest:',
    JSON.stringify(input.artifact.manifest),
    '',
    `clean harness screenshot path: ${screenshotPath}`,
    '',
    'course-library excerpts (cite only these exact excerpts):',
    input.excerpts.length > 0 ? input.excerpts.map(excerptText).join('\n') : '(none)',
  ].join('\n');
}

function modelCritique(
  input: CriticInput,
  dependencies: CriticDependencies,
  screenshotPath: string,
): Promise<{ value: z.infer<typeof CritiqueSchema>; attempts: number }> {
  return runAgentStage({
    role: 'critic',
    toolName: 'submit_critique',
    toolDescription: 'Submit a fidelity critique after the deterministic checks passed.',
    schema: CritiqueSchema,
    userText: criticUserText(input, screenshotPath),
    logId: `${input.jobId}/${input.slideId}`,
  }, dependencies.client, dependencies.promptDirectory);
}

/**
 * Stage 8 single-candidate gate. Manifest checks, property checks, and the
 * injected harness all run before Sonnet; any deterministic problem means no
 * model call and no artifact can be ready.
 */
export async function critique(input: CriticInput, dependencies: CriticDependencies): Promise<CritiqueResult> {
  const violations = artifactViolations(input);
  if (violations.length > 0) {
    const problems = violations.map(violation => `[${violation.rule}] ${violation.detail}`);
    return {
      verdict: 'repair',
      fidelity: 'The artifact failed deterministic validation before fidelity review.',
      problems,
      references: [],
      deterministicProblems: problems,
      verifiedReferences: [],
    };
  }

  const render = await dependencies.render({
    artifactDir: input.artifactDir,
    parameters: { ...input.artifact.manifest.defaultParameters },
  });
  const renderFailureProblems = renderProblems(render);
  if (renderFailureProblems.length > 0) {
    return {
      verdict: 'repair',
      fidelity: 'The artifact did not pass the deterministic harness render check.',
      problems: renderFailureProblems,
      references: [],
      deterministicProblems: renderFailureProblems,
      ...(render.screenshotPath ? { screenshotPath: render.screenshotPath } : {}),
      verifiedReferences: [],
    };
  }

  // RenderCheck's successful contract requires screenshotPath; the branch above
  // rejects its absence, so this assertion is safe and documents the gate.
  const screenshotPath = render.screenshotPath!;
  try {
    const model = await modelCritique(input, dependencies, screenshotPath);
    const references = verifyReferences(model.value.references, input.excerpts);
    return {
      ...model.value,
      references: references.kept.map(reference => ({ docId: reference.docId, page: reference.page, quote: reference.quote })),
      screenshotPath,
      deterministicProblems: [],
      verifiedReferences: references.kept,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown critic failure';
    return {
      verdict: 'repair',
      fidelity: 'The fidelity critic did not produce a valid critique.',
      problems: [`Critic failed: ${message}`],
      references: [],
      screenshotPath,
      deterministicProblems: [],
      verifiedReferences: [],
    };
  }
}

export type RepairArtifact = (input: {
  artifact: ArtifactDirectory;
  problems: readonly string[];
  attempt: number;
}) => Promise<ArtifactDirectory>;

/**
 * Run the stage 8 repair budget. Every candidate, including the initial
 * retrieved artifact and every repair, goes back through the same harness gate.
 */
export async function runCritiqueLoop(
  input: CriticInput,
  dependencies: CriticDependencies & { repair: RepairArtifact },
): Promise<CritiqueLoopResult> {
  let artifact = input.artifact;
  let currentInput = input;
  let lastCritique: CritiqueResult | undefined;

  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const result = await critique(currentInput, dependencies);
    lastCritique = result;
    if (result.verdict === 'pass' && result.screenshotPath) {
      return {
        status: 'ready',
        artifact,
        critique: result,
        screenshotPath: result.screenshotPath,
      };
    }
    if (attempt === 2) break;

    const problems = result.problems.length > 0
      ? result.problems
      : [`Critic verdict was ${result.verdict}; provide a concrete correction.`];
    artifact = await dependencies.repair({ artifact, problems, attempt: attempt + 1 });
    currentInput = { ...currentInput, artifact };
  }

  return {
    status: 'no-visual',
    reason: 'The artifact failed deterministic or fidelity checks after two repairs.',
    ...(lastCritique ? { lastCritique } : {}),
  };
}

/** Hard-rule-5 seam: only a result with a screenshot from a clean harness is publishable. */
export function assertArtifactReady(result: CritiqueLoopResult): asserts result is ReadyVisualization {
  if (result.status !== 'ready' || !result.artifact || !result.screenshotPath || result.critique.deterministicProblems.length > 0) {
    throw new Error('artifact is not harness-verified and cannot reach the instructor draft or publish stage');
  }
}

/** Lambda-shaped handler for one candidate; orchestration supplies render/client. */
export async function handler(input: CriticInput, dependencies: CriticDependencies): Promise<CritiqueResult> {
  return critique(input, dependencies);
}

// Kept as an exported utility for callers that want the deterministic report
// without accidentally duplicating its order or checks.
export function formatDeterministicProblems(input: CriticInput): string {
  return formatViolations(artifactViolations(input));
}

// Ensure the imported schema remains part of the critic's typed boundary even
// if a future compiler narrows the inferred manifest type.
export const criticManifestSchema = ArtifactManifestSchema;
