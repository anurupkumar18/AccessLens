import { describe, expect, it } from 'vitest';
import { AgentStageError, type MessagesClient } from '../shared/agentStage';
import { authorSlide, type PackAuthorInput } from './index';

const validDraft = {
  title: 'Graph overview',
  readingOrder: ['title', 'graph'],
  regions: [{
    regionId: 'graph',
    bounds: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
    shortDescription: 'A graph with connected nodes.',
    plainLanguage: 'Dots are connected by lines.',
  }],
  references: [],
};

function fakeClient(script: unknown[]): { client: MessagesClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: {
      messages: {
        async create(body) {
          calls.push(body);
          const input = script[calls.length - 1];
          if (input instanceof Error) throw input;
          if (input === null) return { content: [{ type: 'text' }] };
          return { content: [{ type: 'tool_use', name: 'submit_slide_description', input }], stop_reason: 'tool_use' };
        },
      },
    },
  };
}

const input = (over: Partial<PackAuthorInput> = {}): PackAuthorInput => ({
  jobId: 'job-1',
  packId: 'pack-1',
  assetId: 'slide-01',
  slideNumber: 1,
  mediaKey: 'staging/job-1/media/slide-01.png',
  imageBase64: 'cG5n',
  extractedText: 'The graph has three layers and a green entry node.',
  lesson: {
    subject: 'Computer science', level: 'Graduate', summary: 'Graphs and search.',
    concepts: [{ name: 'graphs', slideRange: [1, 2] }], references: [],
  },
  excerpts: [{ chunkId: 'chunk-1', docId: 'course-notes', title: 'Course notes', page: 4, score: 0.9, text: 'The graph has three layers.' }],
  ...over,
});

describe('authorSlide', () => {
  it('passes extracted text and formatted excerpts to the user turn and verifies references', async () => {
    const { client, calls } = fakeClient([{
      ...validDraft,
      references: [
        { docId: 'course-notes', page: 4, quote: 'The graph has three layers.' },
        { docId: 'not-given', page: 1, quote: 'invented citation' },
      ],
    }]);
    const result = await authorSlide(input(), { agentClient: client });
    const content = (calls[0].messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0].content;
    const userText = content.find(part => part.type === 'text')?.text ?? '';
    expect(userText).toContain('The graph has three layers and a green entry node.');
    expect(userText).toContain('docId: course-notes');
    expect(userText).toContain('title: Course notes');
    expect(userText).toContain('page: 4');
    expect(result.asset.references).toEqual([{
      docId: 'course-notes', title: 'Course notes', page: 4, quote: 'The graph has three layers.',
    }]);
    expect(result.status).toBe('ok');
  });

  it('repairs an invalid draft on the second attempt', async () => {
    const { client } = fakeClient([{ ...validDraft, title: '' }, validDraft]);
    const result = await authorSlide(input(), { agentClient: client });
    expect(result.attempts).toBe(2);
  });

  it('stores empty regions and a needs_review flag after three failed attempts', async () => {
    const { client } = fakeClient([null, null, null]);
    const progress: Array<{ status: string; stage: string; error?: string }> = [];
    const result = await authorSlide(input(), {
      agentClient: client,
      onProgress: update => progress.push(update),
    });
    expect(result.asset.regions).toEqual([]);
    expect(result.asset.readingOrder).toEqual([]);
    expect(result.status).toBe('needs_review');
    expect(progress.at(-1)?.status).toBe('needs_review');
    expect(result.error).toBeInstanceOf(AgentStageError);
  });
});
