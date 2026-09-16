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
    expect(states.VisualizationStagesPassThrough).toMatchObject({ Type: 'Pass', Next: 'SlideComplete' });
    expect(states.Audio.Next).toBe('VisualizationStagesPassThrough');
  });

  it('does not put a published prefix in any early-stage resource or parameter', () => {
    const serialized = JSON.stringify(definition);
    expect(serialized).not.toMatch(/(?:packs|media|artifacts)\//);
    expect(serialized).not.toContain('published');
  });
});
