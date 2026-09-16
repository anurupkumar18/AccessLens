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
    States: Record<string, { Type: string; Resource?: string; Next?: string; Parameters?: Record<string, unknown>; ItemSelector?: Record<string, unknown>; Catch?: unknown; ItemProcessor?: { States: Record<string, { Type: string; Resource?: string; Next?: string; Parameters?: Record<string, unknown> }> } }>;
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

  it('selects only fields the spine stages read, so a job with no hints cannot fail the Map', () => {
    const selector = spine.States.SlideMap.ItemSelector as Record<string, unknown>;
    for (const key of ['instructorHint.$', 'parameters.$', 'catalogBucket.$', 'repairState']) expect(selector[key], key).toBeUndefined();
    expect(selector['lesson.$']).toBe('$.analyst.lesson');
  });

  it('marks the job failed when a slide fails, instead of leaving it visualizing', () => {
    expect(spine.States.SlideMap.Catch).toEqual([{ ErrorEquals: ['States.ALL'], ResultPath: '$.stageError', Next: 'MarkFailed' }]);
  });

  it('appends each slide to the job record so review and publish know the assets', () => {
    expect(slide.FinishSlide.Next).toBe('RecordSlideProgress');
    const record = slide.RecordSlideProgress as { Resource?: string; Parameters?: { UpdateExpression: string; ExpressionAttributeValues: { ':slide': { L: Array<{ M: Record<string, { S?: string }> }> } } }; ResultPath?: unknown; End?: boolean };
    expect(record.Resource).toBe('arn:aws:states:::dynamodb:updateItem');
    expect(record.Parameters?.UpdateExpression).toContain('list_append(if_not_exists(#slides, :empty), :slide)');
    expect(record.Parameters?.ExpressionAttributeValues[':slide'].L[0].M.status.S).toBe('no_visual');
    expect(record.ResultPath).toBeNull();
    expect(record.End).toBe(true);
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

  it('selects the visualization inputs for the branch', () => {
    const selector = (full.States.SlideMap as { ItemSelector?: Record<string, unknown> }).ItemSelector!;
    expect(selector['instructorHint.$']).toBe('$.instructorHint');
    expect(selector.repairState).toEqual({ repairCount: 0 });
  });

  it('enters the visualization branch after Audio and every Task has a Resource', () => {
    expect(slide.Audio.Next).toBe('VisualizationStagesPassThrough');
    expect(slide.Planner.Resource).toBe('arn:planner');
    for (const state of Object.values(slide)) {
      if (state.Type === 'Task') expect(state.Resource, JSON.stringify(state)).toBeTruthy();
    }
  });
});
