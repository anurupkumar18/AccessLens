import { describe, expect, it, vi } from 'vitest';
import type { MessagesClient } from '../shared/agentStage';
import type { VizPlan } from '../shared/jobs';
import { assertArtifactReady, critique, runCritiqueLoop, type CriticInput, type RenderCheck } from './critic';
import type { ArtifactDirectory } from './artifact';

const plan: VizPlan = {
  decision: 'retrieve',
  concept: 'graph search',
  interaction: 'stepper',
  rationale: 'A stepper shows graph search one step at a time.',
  parametersWanted: [],
  references: [],
};
const artifact: ArtifactDirectory = {
  manifest: {
    schemaVersion: '1.0',
    artifactId: 'graph-stepper',
    artifactVersion: 1,
    title: 'Graph stepper',
    summary: 'Step through a graph search.',
    subjects: ['computer-science'],
    tags: ['graph'],
    interaction: 'stepper',
    provenance: { kind: 'catalog', sourceUrl: 'https://example.org/graph', license: 'MIT' },
    parameters: { type: 'object', properties: { beamWidth: { type: 'integer' } } },
    defaultParameters: { beamWidth: 8 },
    libraries: [],
    accessibility: {
      description: 'A graph with a current node, visited nodes, and a dashed frontier.',
      keyboard: 'Space advances one step and announces the current node.',
    },
    render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
  },
  indexHtml: '<html><body><div role="status" aria-live="polite"></div><script>window.accesslensInit=function(){}; document.addEventListener("keydown", function(){});</script></body></html>',
  assets: {},
  references: [],
};

const input: CriticInput = {
  plan,
  artifact,
  artifactDir: '/tmp/artifact-graph-stepper',
  jobId: 'job-critic',
  slideId: 'slide-1',
  excerpts: [],
};

function modelClient(result: unknown): { client: MessagesClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: { messages: { async create(body) {
      calls.push(body);
      return { content: [{ type: 'tool_use', name: 'submit_critique', input: result }], stop_reason: 'tool_use' };
    } } },
  };
}

const passingRender: RenderCheck = vi.fn(async () => ({
  ok: true,
  consoleErrors: [],
  unhandledRejections: [],
  screenshotPath: '/tmp/graph.png',
}));

const passingModelResult = {
  verdict: 'pass',
  fidelity: 'The stepper faithfully represents graph search.',
  problems: [],
  references: [],
};

describe('critique', () => {
  it('does not call Bedrock or render when manifest validation fails', async () => {
    const client = modelClient(passingModelResult);
    const render = vi.fn(async () => ({ ok: true, consoleErrors: [], unhandledRejections: [], screenshotPath: '/tmp/no.png' }));
    const invalid = { ...input, artifact: { ...artifact, manifest: { ...artifact.manifest, libraries: ['not-blessed'] } } as any };
    const result = await critique(invalid, { client: client.client, render });
    expect(result.verdict).toBe('repair');
    expect(result.problems.join(' ')).toMatch(/manifest|library/i);
    expect(client.calls).toHaveLength(0);
    expect(render).not.toHaveBeenCalled();
  });

  it('runs the deterministic harness before Bedrock and rejects console errors', async () => {
    const client = modelClient(passingModelResult);
    const render = vi.fn(async () => ({ ok: false, consoleErrors: ['ReferenceError: x is not defined'], unhandledRejections: [], screenshotPath: '/tmp/bad.png' }));
    const result = await critique(input, { client: client.client, render });
    expect(render).toHaveBeenCalledWith({ artifactDir: input.artifactDir, parameters: { beamWidth: 8 } });
    expect(result.verdict).toBe('repair');
    expect(result.problems).toContain('Harness console error: ReferenceError: x is not defined');
    expect(client.calls).toHaveLength(0);
  });

  it('calls the model only after a clean render and preserves the screenshot', async () => {
    const client = modelClient(passingModelResult);
    const result = await critique(input, { client: client.client, render: passingRender });
    expect(result).toMatchObject({ verdict: 'pass', fidelity: passingModelResult.fidelity });
    expect(client.calls).toHaveLength(1);
    expect(passingRender).toHaveBeenCalledTimes(1);
  });
});

describe('runCritiqueLoop', () => {
  it('passes concrete critic problems into the repair attempt', async () => {
    const render = vi.fn()
      .mockResolvedValueOnce({ ok: false, consoleErrors: ['bad label'], unhandledRejections: [], screenshotPath: '/tmp/bad.png' })
      .mockResolvedValueOnce({ ok: true, consoleErrors: [], unhandledRejections: [], screenshotPath: '/tmp/good.png' });
    const client = modelClient(passingModelResult);
    const repair = vi.fn(async ({ problems }: { problems: readonly string[] }) => {
      expect(problems).toContain('Harness console error: bad label');
      return artifact;
    });
    const result = await runCritiqueLoop(input, { client: client.client, render, repair });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') expect(result.artifact).toBe(artifact);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(client.calls).toHaveLength(1);
  });

  it('returns no-visual after two failed repair loops', async () => {
    const render = vi.fn(async () => ({ ok: false, consoleErrors: ['still broken'], unhandledRejections: [], screenshotPath: '/tmp/bad.png' }));
    const client = modelClient(passingModelResult);
    const repair = vi.fn(async () => artifact);
    const result = await runCritiqueLoop(input, { client: client.client, render, repair });
    expect(result.status).toBe('no-visual');
    expect('artifact' in result).toBe(false);
    expect(repair).toHaveBeenCalledTimes(2);
    expect(client.calls).toHaveLength(0);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('cannot mark an artifact ready without the harness-backed result', () => {
    expect(() => assertArtifactReady({ status: 'no-visual' } as any)).toThrow(/harness/i);
  });
});
