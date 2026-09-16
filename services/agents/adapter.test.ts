import { describe, expect, it } from 'vitest';
import type { ArtifactManifest } from '../../apps/extension/src/shared/contracts';
import type { MessagesClient } from '../shared/agentStage';
import type { Excerpt } from '../shared/references';
import type { VizPlan } from '../shared/jobs';
import { adaptArtifact, type AdapterInput } from './adapter';

const parentManifest: ArtifactManifest = {
  schemaVersion: '1.0',
  artifactId: 'graph-stepper',
  artifactVersion: 1,
  title: 'Graph stepper',
  summary: 'Step through a graph search.',
  subjects: ['computer-science'],
  tags: ['graph'],
  interaction: 'stepper',
  provenance: { kind: 'catalog', sourceUrl: 'https://example.org/graph', license: 'MIT' },
  parameters: { type: 'object', properties: { beamWidth: { type: 'integer', minimum: 1, maximum: 64 } } },
  defaultParameters: { beamWidth: 8 },
  libraries: ['d3@7'],
  accessibility: {
    description: 'A graph with a highlighted current node and visited nodes.',
    keyboard: 'Space advances one search step.',
    semanticOutline: ['Current node', 'Visited nodes'],
  },
  render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
};

const plan: VizPlan = {
  decision: 'adapt',
  concept: 'graph search',
  interaction: 'stepper',
  rationale: 'Use the graph stepper with course labels.',
  parametersWanted: ['beamWidth'],
  references: [],
};

const input: AdapterInput = {
  parent: { manifest: parentManifest, indexHtml: '<html><script>window.accesslensInit=function(){};</script></html>' },
  plan,
  jobId: 'job-adapt',
  slideId: 'slide-2',
  excerpts: [] as Excerpt[],
};

function modelClient(result: unknown): { client: MessagesClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: { messages: { async create(body) {
      calls.push(body);
      return { content: [{ type: 'tool_use', name: 'submit_adapted_artifact', input: result }], stop_reason: 'tool_use' };
    } } },
  };
}

const validArtifact = (overrides: Record<string, unknown> = {}) => ({
  manifest: {
    ...parentManifest,
    artifactId: 'graph-stepper-adapted',
    artifactVersion: 1,
    provenance: {
      kind: 'adapted',
      parentArtifactId: 'graph-stepper',
      parentArtifactVersion: 1,
      sourceUrl: 'https://example.org/graph',
      license: 'MIT',
      generatedBy: 'us.anthropic.claude-sonnet-4-6',
      jobId: 'job-adapt',
    },
    defaultParameters: { beamWidth: 12 },
    ...overrides,
  },
  indexHtml: '<html><body><div role="status" aria-live="polite"></div><script>window.accesslensInit=function(){}; document.addEventListener("keydown", function(){});</script></body></html>',
  assets: {},
  references: [],
});

describe('adaptArtifact', () => {
  it('carries parent id, version, license, and job into adapted provenance', async () => {
    const { client } = modelClient(validArtifact());
    const result = await adaptArtifact(input, { client });
    expect(result.artifact.manifest.provenance).toMatchObject({
      kind: 'adapted', parentArtifactId: 'graph-stepper', parentArtifactVersion: 1, license: 'MIT', jobId: 'job-adapt',
    });
    expect(result.artifact.manifest.defaultParameters).toEqual({ beamWidth: 12 });
  });

  it('includes parent source, plan, and excerpts but not the slide in the model turn', async () => {
    const { client, calls } = modelClient(validArtifact());
    await adaptArtifact(input, { client });
    const text = (calls[0].messages as any)[0].content.find((part: any) => part.type === 'text').text;
    expect(text).toContain('parent artifact source');
    expect(text).toContain('graph-stepper');
    expect(text).toContain('visualization plan');
    expect(text).not.toContain('slide PNG');
  });

  it('rejects a changed parent license before returning an artifact', async () => {
    const { client } = modelClient(validArtifact({ provenance: {
      kind: 'adapted', parentArtifactId: 'graph-stepper', parentArtifactVersion: 1,
      sourceUrl: 'https://example.org/graph', license: 'Apache-2.0', generatedBy: 'us.anthropic.claude-sonnet-4-6', jobId: 'job-adapt',
    } }));
    await expect(adaptArtifact(input, { client })).rejects.toThrow(/license/);
  });
});
