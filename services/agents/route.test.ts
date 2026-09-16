import { describe, expect, it, vi } from 'vitest';
import type { ArtifactManifest } from '../../apps/extension/src/shared/contracts';
import type { VizPlan } from '../shared/jobs';
import { routeVisualization, type RouteDependencies } from './route';

const plan = (decision: VizPlan['decision']): VizPlan => ({
  decision,
  concept: decision === 'none' ? '' : 'graph search',
  rationale: 'A graph benefits from a stepper.',
  parametersWanted: [],
  references: [],
});

const manifest: ArtifactManifest = {
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
    description: 'A graph with a highlighted current node and visited nodes.',
    keyboard: 'Space advances one search step.',
  },
  render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
};

const deps = (matches: any[]): RouteDependencies & { retrieve: ReturnType<typeof vi.fn> } => {
  const retrieve = vi.fn(async () => matches);
  return { retrieveCatalog: retrieve, retrieve };
};

describe('routeVisualization', () => {
  it('forces generate when retrieval is empty, even when the planner said retrieve', async () => {
    const dependencies = deps([]);
    await expect(routeVisualization({ plan: plan('retrieve'), jobId: 'job-1', slideId: 'slide-1' }, dependencies))
      .resolves.toMatchObject({ decision: 'generate', matches: [] });
    expect(dependencies.retrieve).toHaveBeenCalledWith('graph search', 5);
  });

  it('short-circuits a strong catalog match without calling an agent model', async () => {
    const dependencies = deps([{ artifactId: 'graph-stepper', artifactVersion: 1, score: 0.91, manifest }]);
    await expect(routeVisualization({ plan: plan('retrieve'), jobId: 'job-1', slideId: 'slide-1' }, dependencies))
      .resolves.toMatchObject({ decision: 'retrieve', parent: { artifactId: 'graph-stepper' } });
    expect(dependencies.retrieve).toHaveBeenCalledTimes(1);
  });

  it('retrieves for adapt as well as retrieve, preserving the best parent', async () => {
    const dependencies = deps([{ artifactId: 'graph-stepper', artifactVersion: 1, score: 0.72, manifest }]);
    await expect(routeVisualization({ plan: plan('adapt'), jobId: 'job-1', slideId: 'slide-1' }, dependencies))
      .resolves.toMatchObject({ decision: 'adapt', parent: { artifactId: 'graph-stepper' } });
  });

  it('does not retrieve for none', async () => {
    const dependencies = deps([{ artifactId: 'unused', artifactVersion: 1, score: 1, manifest }]);
    await expect(routeVisualization({ plan: plan('none'), jobId: 'job-1', slideId: 'slide-1' }, dependencies))
      .resolves.toMatchObject({ decision: 'none', matches: [] });
    expect(dependencies.retrieve).not.toHaveBeenCalled();
  });
});
