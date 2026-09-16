import { z } from 'zod';
import { AgentStageError } from '../shared/agentStage';
import {
  ArtifactDirectorySchema,
  artifactDirectoryWithVerifiedReferences,
  assertGeneratedProvenance,
  writeArtifactDirectory,
  type ArtifactAgentResult,
} from './artifact';
import { runAgentStage, type MessagesClient } from '../shared/agentStage';
import type { VizPlan } from '../shared/jobs';
import { verifyReferences, type Excerpt } from '../shared/references';

export interface GeneratorInput {
  plan: VizPlan;
  jobId: string;
  slideId: string;
  excerpts: readonly Excerpt[];
  /** Concrete changes supplied by the critic during a repair loop. */
  repairProblems?: readonly string[];
  /** Optional staging path where the complete artifact directory is materialized. */
  outputDir?: string;
}

export interface GeneratorDependencies {
  client?: MessagesClient;
  promptDirectory?: string;
  /**
   * Test-only assertion seam. Rendering belongs to the Critic, so this value is
   * intentionally never called by the Generator.
   */
  render?: unknown;
}

const GeneratorModelOutputSchema = ArtifactDirectorySchema;

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

function generatorUserText(input: GeneratorInput): string {
  return [
    'Create a small, self-contained visualization for this plan.',
    '',
    `jobId: ${input.jobId}`,
    `slideId: ${input.slideId}`,
    '',
    'visualization plan:',
    JSON.stringify(input.plan),
    '',
    'course-library excerpts (cite only these exact excerpts):',
    input.excerpts.length > 0 ? input.excerpts.map(excerptText).join('\n') : '(none)',
    '',
    'specific repair problems from the previous critic attempt:',
    input.repairProblems && input.repairProblems.length > 0 ? input.repairProblems.map(problem => `- ${problem}`).join('\n') : '(none; this is the first generation attempt)',
  ].join('\n');
}

/**
 * Stage 7b: ask Sonnet for a complete artifact when retrieval did not produce a
 * usable parent. The output is only schema/provenance checked here; the Critic
 * owns static HTML checks and the injected harness render, so this stage never
 * sends an untrusted artifact to a browser.
 */
export async function generateArtifact(input: GeneratorInput, dependencies: GeneratorDependencies = {}): Promise<ArtifactAgentResult> {
  let result;
  try {
    result = await runAgentStage({
      role: 'generator',
      toolName: 'submit_generated_artifact',
      toolDescription: 'Submit a complete generated artifact directory.',
      schema: GeneratorModelOutputSchema,
      userText: generatorUserText(input),
      logId: `${input.jobId}/${input.slideId}`,
    }, dependencies.client, dependencies.promptDirectory);
  } catch (error) {
    if (error instanceof AgentStageError && error.issues.flat().some(issue => /librar|blessed/i.test(issue))) {
      throw new Error(`generated artifact manifest failed library validation: ${error.message}`, { cause: error });
    }
    throw error;
  }

  // ArtifactManifestSchema (inside ArtifactDirectorySchema) rejects an
  // undeclared library before this point. The explicit provenance check keeps
  // the job id invariant at the stage boundary as well.
  assertGeneratedProvenance(result.value.manifest, input.jobId);
  const references = verifyReferences(result.value.references, input.excerpts);
  const output: ArtifactAgentResult = {
    artifact: artifactDirectoryWithVerifiedReferences(result.value, references.kept),
    verifiedReferences: references.kept,
    attempts: result.attempts,
  };
  if (input.outputDir) await writeArtifactDirectory(output.artifact, input.outputDir);
  return output;
}

/** Stage 7b Lambda-shaped handler. */
export async function handler(input: GeneratorInput, dependencies: GeneratorDependencies = {}): Promise<ArtifactAgentResult> {
  return generateArtifact(input, dependencies);
}

/** Exported for callers that need the exact tool schema without duplicating it. */
export const generatorOutputSchema = GeneratorModelOutputSchema;
