import { describe, expect, it } from 'vitest';
import { LessonSchema, type Deck } from '../shared/jobs';
import type { MessagesClient } from '../shared/agentStage';
import { handleDeckAnalyst, runDeckAnalyst, type AnalystEvent } from './analyst';

const lesson = {
  subject: 'Graphs', level: 'Graduate', summary: 'A graph lesson.',
  concepts: [{ name: 'graphs', slideRange: [1, 2] as [number, number] }],
  references: [{ docId: 'notes', page: 4, quote: 'Graph theory' }],
};

const deck: Deck = {
  jobId: 'job-analyst', packId: 'pack', title: 'Deck title', sourceKey: 'upload.pdf', sourceFormat: 'pdf',
  matching: { algorithm: 'dhash12', hashBits: 132, maxHammingDistance: 26, minMargin: 14, onNoMatch: 'source.unmatched' },
  slides: [1, 2, 3, 4].map(page => ({
    assetId: `slide-0${page}`, page, mediaKey: `staging/job-analyst/media/slide-0${page}.png`,
    width: 1920, height: 1080, fingerprint: `dhash12:${page}`, extractedText: `Text from slide ${page}`,
  })),
};

function fakeClient(calls: Record<string, unknown>[]): MessagesClient {
  return { messages: { async create(body) {
    calls.push(body);
    return { content: [{ type: 'tool_use', name: 'submit_lesson', input: lesson }], stop_reason: 'tool_use' };
  } } };
}

const event: AnalystEvent = {
  jobId: deck.jobId, packId: deck.packId, title: deck.title, deck,
  excerpts: [{ chunkId: 'c', docId: 'notes', title: 'Notes', page: 4, score: 1, text: 'Graph theory is useful.' }],
};

describe('deck analyst', () => {
  it('hydrates an ingested deck from staging and sends all text plus only the first three PNGs', async () => {
    const calls: Record<string, unknown>[] = [];
    const writes: Array<{ key: string; body: string }> = [];
    const objects = new Map(deck.slides.map((slide, index) => [slide.mediaKey, new Uint8Array([index + 1])]));
    const result = await handleDeckAnalyst(event, {
      agentClient: fakeClient(calls),
      readObject: async key => objects.get(key)!,
      writeObject: async (key, body) => writes.push({ key, body }),
    });
    expect(result.status).toBe('ok');
    const content = (calls[0].messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0].content;
    const text = content.find(part => part.type === 'text')?.text ?? '';
    expect(text).toContain('Text from slide 4');
    expect(content.filter(part => part.type === 'image')).toHaveLength(3);
    expect(text).toContain('docId: notes');
    expect(text).toContain('page: 4');
    expect(writes[0].key).toBe('staging/job-analyst/lesson.json');
    expect(LessonSchema.parse(JSON.parse(writes[0].body))).toEqual(result.lesson);
  });

  it('drops an unverified analyst citation while retaining the verified claim in LessonSchema shape', async () => {
    const result = await runDeckAnalyst({
      jobId: 'job', packId: 'pack', title: 'Deck', slideCount: 2,
      extractedText: 'text', slides: [{ assetId: 'slide-01', page: 1, extractedText: 'text' }],
      excerpts: [{ chunkId: 'c', docId: 'notes', title: 'Notes', page: 4, score: 1, text: 'Graph theory is useful.' }],
    }, { agentClient: fakeClient([]) });
    expect(result.lesson?.references).toEqual([{ docId: 'notes', page: 4, quote: 'Graph theory' }]);
    expect(LessonSchema.parse(result.lesson)).toEqual(result.lesson);
  });
});
