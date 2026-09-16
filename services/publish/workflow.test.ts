import { describe, expect, it } from 'vitest';
import { authoringStateMachine } from './workflow';

describe('authoringStateMachine', () => {
  const definition = authoringStateMachine({ ingest: 'arn:ingest', analyst: 'arn:analyst', packAuthor: 'arn:author', audio: 'arn:audio', publish: 'arn:publish' }) as any;
  it('maps slides with concurrency five', () => {
    const map = Object.values(definition.States).find((state: any) => state.Type === 'Map') as any;
    expect(map).toBeDefined();
    expect(map.MaxConcurrency).toBe(5);
  });

  it('runs audio inside the per-slide branch after pack author', () => {
    const map = Object.values(definition.States).find((state: any) => state.Type === 'Map') as any;
    const states = map.ItemProcessor?.States ?? map.Iterator.States;
    expect(states.PackAuthor.Next).toBe('Audio');
    expect(states.Audio.Type).toBe('Task');
  });

  it('leaves a named pass-through visualization extension point after audio', () => {
    const map = Object.values(definition.States).find((state: any) => state.Type === 'Map') as any;
    const states = map.ItemProcessor?.States ?? map.Iterator.States;
    // With no visualization Lambdas wired the extension point finishes the slide.
    expect(states.VisualizationStagesPassThrough).toMatchObject({ Type: 'Pass', Next: 'FinishSlide' });
    expect(states.Audio.Next).toBe('VisualizationStagesPassThrough');
  });

  it('does not put a published prefix in any early-stage resource or parameter', () => {
    const serialized = JSON.stringify(definition);
    // Published prefixes are the publish stage's alone. The job status string
    // "published" legitimately appears in the review-polling Choice, so the
    // check is on S3 key prefixes, not on the word.
    expect(serialized).not.toMatch(/(?:packs|media|artifacts)\//);
  });
});

describe('authoringStateMachine without visualization Lambdas', () => {
  const spine = authoringStateMachine({ ingest: 'arn:ingest', analyst: 'arn:analyst', packAuthor: 'arn:author', audio: 'arn:audio', publish: 'arn:publish' }) as {
    States: Record<string, { Type: string; Resource?: string; Next?: string; Parameters?: Record<string, unknown>; ItemProcessor?: { States: Record<string, { Type: string; Resource?: string; Next?: string; Parameters?: Record<string, unknown> }> } }>;
  };
  const slide = spine.States.SlideMap.ItemProcessor!.States;

  it('finishes the slide at the named extension point', () => {
    expect(slide.Audio.Next).toBe('VisualizationStagesPassThrough');
    expect(slide.VisualizationStagesPassThrough.Next).toBe('FinishSlide');
  });

  it('omits every visualization state rather than emitting a Task with no Resource', () => {
    // A Task whose Resource is undefined is not a state machine; CloudFormation
    // rejects it at deploy time, which is the worst possible place to learn.
    for (const name of ['Planner', 'Route', 'Adapter', 'Generator', 'Critic', 'RecordVisualization', 'RecordNoVisualization']) {
      expect(slide[name], name).toBeUndefined();
    }
    for (const state of Object.values(slide)) {
      if (state.Type === 'Task') expect(state.Resource, JSON.stringify(state)).toBeTruthy();
    }
  });

  it('records every slide as a clean no-visual', () => {
    expect(slide.FinishSlide.Parameters?.visualizationStatus).toBe('no-visual');
  });
});

describe('authoringStateMachine with visualization Lambdas', () => {
  const full = authoringStateMachine({
    ingest: 'arn:ingest', analyst: 'arn:analyst', packAuthor: 'arn:author', audio: 'arn:audio', publish: 'arn:publish',
    planner: 'arn:planner', route: 'arn:route', adapter: 'arn:adapter', generator: 'arn:generator', critic: 'arn:critic', recordVisualization: 'arn:record',
  }) as { States: Record<string, { ItemProcessor?: { States: Record<string, { Type: string; Resource?: string; Next?: string }> } }> };
  const slide = full.States.SlideMap.ItemProcessor!.States;

  it('enters the visualization branch after Audio and every Task has a Resource', () => {
    expect(slide.Audio.Next).toBe('VisualizationStagesPassThrough');
    expect(slide.Planner.Resource).toBe('arn:planner');
    for (const state of Object.values(slide)) {
      if (state.Type === 'Task') expect(state.Resource, JSON.stringify(state)).toBeTruthy();
    }
  });
});
