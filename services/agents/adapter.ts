import { z } from 'zod';
import {
  ArtifactDirectorySchema,
  artifactDirectoryWithVerifiedReferences,
  assertAdaptedProvenance,
  writeArtifactDirectory,
  type ArtifactAgentResult,
  type ArtifactDirectory,
  type ArtifactSource,
} from './artifact';
import { runAgentStage, type MessagesClient } from '../shared/agentStage';
import { VizPlanSchema, type VizPlan } from '../shared/jobs';
import { verifyReferences, type Excerpt, type VerifiedReference } from '../shared/references';

export interface AdapterInput {
  parent: ArtifactSource;
  plan: VizPlan;
  jobId: string;
  slideId: string;
  excerpts: readonly Excerpt[];
  /** Concrete repair notes from the critic, if this is a repair attempt. */
  repairProblems?: readonly string[];
  /** Optional staging path where the complete artifact directory is materialized. */
  outputDir?: string;
}

export interface AdapterDependencies {
  client?: MessagesClient;
  promptDirectory?: string;
}

const AdapterModelOutputSchema = ArtifactDirectorySchema;

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

function adapterUserText(input: AdapterInput): string {
  return [
    'Adapt the selected parent artifact for this visualization plan.',
    '',
    `jobId: ${input.jobId}`,
    `slideId: ${input.slideId}`,
    '',
    'parent artifact source (manifest and files; no slide is supplied):',
    JSON.stringify({
      manifest: input.parent.manifest,
      indexHtml: input.parent.indexHtml,
      assets: input.parent.assets ?? {},
    }),
    '',
    'visualization plan:',
    JSON.stringify(input.plan),
    '',
    'course-library excerpts (cite only these exact excerpts):',
    input.excerpts.length > 0 ? input.excerpts.map(excerptText).join('\n') : '(none)',
    '',
    'specific repair problems from the previous critic attempt:',
    input.repairProblems && input.repairProblems.length > 0 ? input.repairProblems.map(problem => `- ${problem}`).join('\n') : '(none; this is the first adaptation attempt)',
  ].join('\n');
}

function outputResult(
  value: z.infer<typeof AdapterModelOutputSchema>,
  input: AdapterInput,
  attempts: number,
): ArtifactAgentResult {
  // The schema has already checked the output shape. These invariants are
  // checked again at this stage boundary because provenance is the legal chain
  // of custody for a reused artifact, not merely a model-chosen string.
  assertAdaptedProvenance(value.manifest, input.parent.manifest, input.jobId);
  const references = verifyReferences(value.references, input.excerpts);
  return {
    artifact: artifactDirectoryWithVerifiedReferences(value, references.kept),
    verifiedReferences: references.kept,
    attempts,
  };
}

/**
 * Stage 7a: adapt the best catalog artifact. The model sees the parent source
 * and plan, never the slide. Validation/provenance failure is allowed to fall
 * through to the Generator at the orchestration boundary, so this function
 * rejects rather than returning a broken directory.
 */
export async function adaptArtifact(input: AdapterInput, dependencies: AdapterDependencies = {}): Promise<ArtifactAgentResult> {
  const result = await runAgentStage({
    role: 'adapter',
    toolName: 'submit_adapted_artifact',
    toolDescription: 'Submit a complete adapted artifact directory.',
    schema: AdapterModelOutputSchema,
    userText: adapterUserText(input),
    logId: `${input.jobId}/${input.slideId}`,
  }, dependencies.client, dependencies.promptDirectory);
  const output = outputResult(result.value, input, result.attempts);
  if (input.outputDir) await writeArtifactDirectory(output.artifact, input.outputDir);
  return output;
}

/** Stage 7a Lambda-shaped handler. */
export async function handler(input: AdapterInput, dependencies: AdapterDependencies = {}): Promise<ArtifactAgentResult> {
  return adaptArtifact(input, dependencies);
}

/** Exported to make the boundary explicit for repair-loop callers. */
export function adapterPlanSchema(): typeof VizPlanSchema {
  return VizPlanSchema;
}
