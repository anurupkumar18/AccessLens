import { describe, expect, it } from 'vitest';
import type { MessagesClient } from '../shared/agentStage';
import type { VizPlan } from '../shared/jobs';
import { generateArtifact, type GeneratorInput } from './generator';

const plan: VizPlan = {
  decision: 'generate',
  concept: 'supply and demand intersection',
  interaction: 'plot',
  rationale: 'A plot lets students move the curves and see the intersection.',
  parametersWanted: ['demandShift'],
  references: [],
};
const input: GeneratorInput = {
  plan,
  jobId: 'job-generate',
  slideId: 'slide-4',
  excerpts: [],
};

const valid = (libraries: unknown[] = []) => ({
  manifest: {
    schemaVersion: '1.0',
    artifactId: 'supply-demand-plot',
    artifactVersion: 1,
    title: 'Supply and demand',
    summary: 'Move supply and demand curves to see their intersection.',
    subjects: ['economics'],
    tags: ['supply', 'demand'],
    interaction: 'plot',
    provenance: { kind: 'generated', generatedBy: 'us.anthropic.claude-sonnet-4-6', jobId: 'job-generate' },
    parameters: { type: 'object', properties: { demandShift: { type: 'number' } } },
    defaultParameters: { demandShift: 0 },
    libraries,
    accessibility: {
      description: 'A graph with supply and demand curves crossing at an equilibrium price and quantity.',
      keyboard: 'Arrow keys move the demand shift and announce the new intersection.',
    },
    render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
  },
  indexHtml: '<html><body><div role="status" aria-live="polite"></div><script>window.accesslensInit=function(){}; document.addEventListener("keydown", function(){});</script></body></html>',
  assets: {},
  references: [],
});

function modelClient(result: unknown): { client: MessagesClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: { messages: { async create(body) {
      calls.push(body);
      return { content: [{ type: 'tool_use', name: 'submit_generated_artifact', input: result }], stop_reason: 'tool_use' };
    } } },
  };
}

describe('generateArtifact', () => {
  it('returns a generated artifact with job provenance', async () => {
    const { client } = modelClient(valid());
    const result = await generateArtifact(input, { client });
    expect(result.artifact.manifest.provenance).toMatchObject({ kind: 'generated', jobId: 'job-generate' });
  });

  it('rejects an unblessed library at manifest time and does not ask the sandbox to render', async () => {
    const { client, calls } = modelClient(valid(['not-viewer-approved@1']));
    const render = async () => { throw new Error('render must not be called'); };
    await expect(generateArtifact(input, { client, render })).rejects.toThrow(/library|blessed/);
    // Manifest validation is part of runAgentStage's normal three-attempt
    // contract; every attempt is rejected before the injected renderer exists
    // in this stage.
    expect(calls).toHaveLength(3);
  });

  it('passes repair problems into the next generation attempt', async () => {
    const { client, calls } = modelClient(valid());
    await generateArtifact({ ...input, repairProblems: ['Change the x-axis label to quantity.'] }, { client });
    const text = (calls[0].messages as any)[0].content.find((part: any) => part.type === 'text').text;
    expect(text).toContain('Change the x-axis label to quantity.');
  });
});
