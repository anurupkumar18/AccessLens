import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  runAgentStage,
  type ImageInput,
  type MessagesClient,
} from '../shared/agentStage';
import { VizPlanSchema, type Lesson, type SlideDraft, type VizPlan } from '../shared/jobs';
import { verifyReferences, type Excerpt, type VerifiedReference } from '../shared/references';

export interface PlannerInput {
  slideText: string;
  /** Base64-encoded PNG bytes. The planner is the only visualization stage that sees the slide. */
  slideImageBase64: string;
  lesson: Lesson | Omit<Lesson, 'references'>;
  regions: SlideDraft['regions'];
  instructorHint?: string;
  excerpts: readonly Excerpt[];
  jobId: string;
  slideId: string;
}

export interface PlannerDependencies {
  client?: MessagesClient;
  promptDirectory?: string;
}

export interface PlannedVisualization {
  plan: VizPlan;
  references: VerifiedReference[];
  attempts: number;
}

const nonePlan = (reason: string): PlannedVisualization => ({
  plan: {
    decision: 'none',
    concept: '',
    interaction: undefined,
    rationale: reason,
    parametersWanted: [],
    references: [],
  },
  references: [],
  attempts: 0,
});

function promptDirectoryFromSource(): string | undefined {
  // runAgentStage has the normal repository lookup. This helper exists only
  // for Lambda bundles that set VIZ_PROMPT_DIR; returning undefined preserves
  // that shared default and avoids embedding prompt prose in TypeScript.
  return process.env.VIZ_PROMPT_DIR ?? undefined;
}

function formatExcerpt(excerpt: Excerpt): string {
  return JSON.stringify({
    chunkId: excerpt.chunkId,
    docId: excerpt.docId,
    title: excerpt.title,
    page: excerpt.page,
    score: excerpt.score,
    text: excerpt.text,
  });
}

function plannerUserText(input: PlannerInput): string {
  return [
    'Decide whether this slide benefits from an interactive visualization.',
    '',
    `jobId: ${input.jobId}`,
    `slideId: ${input.slideId}`,
    '',
    'slide text:',
    input.slideText,
    '',
    'lesson.json:',
    JSON.stringify(input.lesson),
    '',
    'reviewed regions:',
    JSON.stringify(input.regions),
    '',
    `instructor hint: ${input.instructorHint ?? '(none)'}`,
    '',
    'course-library excerpts (cite only these exact excerpts):',
    input.excerpts.length > 0 ? input.excerpts.map(formatExcerpt).join('\n') : '(none)',
  ].join('\n');
}

/**
 * Stage 5: ask Sonnet for the visualization plan, then verify every claimed
 * library reference against the excerpts this call actually received. A
 * planner failure is deliberately a normal `none` result: an unnecessary or
 * broken visualization is worse than a missing one (spec §8).
 */
export async function planVisualization(
  input: PlannerInput,
  dependencies: PlannerDependencies = {},
): Promise<PlannedVisualization['plan'] & { verifiedReferences?: VerifiedReference[]; attempts?: number }> {
  const client = dependencies.client;
  try {
    const result = await runAgentStage({
      role: 'viz-planner',
      toolName: 'submit_viz_plan',
      toolDescription: 'Submit the restrained visualization plan for this slide.',
      schema: VizPlanSchema,
      userText: plannerUserText(input),
      images: [{ mediaType: 'image/png', base64: input.slideImageBase64 } satisfies ImageInput],
      logId: `${input.jobId}/${input.slideId}`,
    }, client, dependencies.promptDirectory ?? promptDirectoryFromSource());
    const verified = verifyReferences(result.value.references, input.excerpts);
    const plan = { ...result.value, references: verified.kept.map(reference => ({
      docId: reference.docId,
      page: reference.page,
      quote: reference.quote,
    })) };
    return Object.assign(plan, { verifiedReferences: verified.kept, attempts: result.attempts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown planner failure';
    return {
      ...nonePlan(`Planner failed; no visualization was selected (${message})`).plan,
      verifiedReferences: [],
      attempts: 0,
    };
  }
}

/** Explicit result form for callers that want references and attempt metadata without inspecting optional fields. */
export async function planVisualizationResult(
  input: PlannerInput,
  dependencies: PlannerDependencies = {},
): Promise<PlannedVisualization> {
  const value = await planVisualization(input, dependencies);
  return {
    plan: {
      decision: value.decision,
      concept: value.concept,
      ...(value.interaction === undefined ? {} : { interaction: value.interaction }),
      rationale: value.rationale,
      parametersWanted: value.parametersWanted,
      references: value.references,
    },
    references: value.verifiedReferences ?? [],
    attempts: value.attempts ?? 0,
  };
}

export const plannerInputSchema = z.object({
  slideText: z.string(),
  slideImageBase64: z.string().min(1),
  lesson: z.unknown(),
  regions: z.array(z.unknown()),
  instructorHint: z.string().optional(),
  excerpts: z.array(z.unknown()),
  jobId: z.string().min(1),
  slideId: z.string().min(1),
}).strict();

/** Lambda-shaped entry point; orchestration injects the Bedrock client at tests and call sites. */
export async function handler(
  event: PlannerInput,
  dependencies: PlannerDependencies = {},
): Promise<VizPlan> {
  return planVisualization(event, dependencies);
}
