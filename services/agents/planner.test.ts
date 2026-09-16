import { describe, expect, it, vi } from 'vitest';
import type { MessagesClient } from '../shared/agentStage';
import { planVisualization, type PlannerInput } from './planner';

const baseInput = (overrides: Partial<PlannerInput> = {}): PlannerInput => ({
  slideText: 'A title slide',
  slideImageBase64: 'c2xpZGU=',
  lesson: {
    subject: 'computer science',
    level: 'undergraduate',
    summary: 'A course about algorithms and data structures.',
    concepts: [{ name: 'graphs', slideRange: [1, 3] }],
  },
  regions: [{
    regionId: 'title',
    bounds: { x: 0, y: 0, width: 1, height: 0.2 },
    shortDescription: 'A title about graphs.',
    plainLanguage: 'The slide names graphs.',
  }],
  instructorHint: undefined,
  excerpts: [],
  jobId: 'job-1',
  slideId: 'slide-1',
  ...overrides,
});

function modelClient(input: unknown): { client: MessagesClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: {
      messages: {
        async create(body) {
          calls.push(body);
          return { content: [{ type: 'tool_use', name: 'submit_viz_plan', input }], stop_reason: 'tool_use' };
        },
      },
    },
  };
}

describe('planVisualization', () => {
  it('returns none for a title slide without relying on model restraint', async () => {
    const { client } = modelClient({ decision: 'none', concept: '', rationale: 'A title does not need an interactive.' });
    await expect(planVisualization(baseInput(), { client })).resolves.toMatchObject({ decision: 'none' });
  });

  it('returns none for an agenda slide', async () => {
    const { client } = modelClient({ decision: 'none', concept: '', rationale: 'An agenda is already a list.' });
    await expect(planVisualization(baseInput({ slideText: 'Agenda\n1. Intro\n2. Methods\n3. Results' }), { client }))
      .resolves.toMatchObject({ decision: 'none' });
  });

  it('returns a real plan for a diagram slide and sends its image and context', async () => {
    const { client, calls } = modelClient({
      decision: 'retrieve',
      concept: 'hierarchical graph search',
      interaction: 'stepper',
      rationale: 'A stepper can show the search moving through the graph.',
      parametersWanted: ['ef'],
    });
    const result = await planVisualization(baseInput({ slideText: 'Layered graph search', slideImageBase64: 'PNG' }), { client });
    expect(result).toMatchObject({ decision: 'retrieve', concept: 'hierarchical graph search', interaction: 'stepper' });
    expect(calls).toHaveLength(1);
    const content = (calls[0].messages as any)[0].content;
    expect(content[0]).toMatchObject({ type: 'image', source: { data: 'PNG' } });
    expect(content[1].text).toContain('Layered graph search');
    expect(content[1].text).toContain('lesson.json');
  });

  it('defaults to none when the model stage fails', async () => {
    const client: MessagesClient = {
      messages: {
        create: vi.fn(async () => { throw new Error('Bedrock unavailable'); }),
      },
    };
    await expect(planVisualization(baseInput(), { client })).resolves.toMatchObject({
      decision: 'none',
      concept: '',
      rationale: expect.stringContaining('failed'),
    });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});
