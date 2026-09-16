import { describe, expect, it, vi } from 'vitest';
import { issueCapability } from '../../live-session/src/capability.js';
import { CHAT_LIMITS, SEARCH_TOOL, lessonMaterial, readTurns, runChat, type ChatDeps, type ChatEvent, type ConverseStreamEvent, type ConverseStreamer } from '../src/chat.js';
import { CHAT_MESSAGES_PER_MINUTE, createChatHandler, type ChatResponse } from '../src/chatHandler.js';
import { bedrockKnowledgeBase, type CourseKnowledge } from '../src/knowledge.js';
import { createPackLoader, reviewedPack } from '../src/packs.js';

const SECRET = 'test-secret-with-enough-entropy-000000000000';
const NOW = new Date('2026-09-16T18:00:00Z');
const pack = reviewedPack('bio-cell-demo', 1)!;
const student = issueCapability('SESS01', 'student', SECRET, NOW);

/** A Converse stream that says `text`, stopping for `stopReason`. */
function says(text: string, stopReason = 'end_turn'): ConverseStreamEvent[] {
  return [
    ...text.split(/(?<= )/).map(piece => ({ contentBlockDelta: { contentBlockIndex: 0, delta: { text: piece } } })),
    { messageStop: { stopReason } },
  ];
}

/** A Converse stream in which the model asks to search for `query`. */
function searches(query: string, id = 'tool-1'): ConverseStreamEvent[] {
  return [
    { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Let me check the course files. ' } } },
    { contentBlockStart: { contentBlockIndex: 1, start: { toolUse: { toolUseId: id, name: 'search_course_materials' } } } },
    { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: `{"query":` } } } },
    { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: JSON.stringify(query) + '}' } } } },
    { messageStop: { stopReason: 'tool_use' } },
  ];
}

function fakeBedrock(...replies: ConverseStreamEvent[][]) {
  const requests: Parameters<ConverseStreamer>[0][] = [];
  const converse: ConverseStreamer = request => {
    requests.push(structuredClone(request));
    const reply = replies.shift() ?? says('(no more replies)');
    return (async function* () { yield* reply; })();
  };
  return { converse, requests };
}

async function collect(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const text = (events: ChatEvent[]) => events.filter(e => e.type === 'delta').map(e => (e as { text: string }).text).join('');

describe('readTurns', () => {
  it('keeps trimmed student and assistant turns ending with the student', () => {
    expect(readTurns([{ role: 'student', text: '  What is a nucleus? ' }])).toEqual([{ role: 'student', text: 'What is a nucleus?' }]);
    expect(readTurns([{ role: 'student', text: 'Hi' }, { role: 'assistant', text: 'Hello' }])).toBeNull();
    expect(readTurns([{ role: 'teacher', text: 'x' }])).toBeNull();
    expect(readTurns([{ role: 'student', text: 'x'.repeat(CHAT_LIMITS.turnChars + 1) }])).toBeNull();
    expect(readTurns('not a list')).toBeNull();
  });

  it('sends only the most recent turns within the limits, starting with the student', () => {
    const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? 'student' : 'assistant', text: `turn ${i}` }));
    long.push({ role: 'student', text: 'latest' });
    const kept = readTurns(long)!;
    expect(kept.length).toBeLessThanOrEqual(CHAT_LIMITS.turns);
    expect(kept[0]!.role).toBe('student');
    expect(kept.at(-1)).toEqual({ role: 'student', text: 'latest' });
  });
});

describe('lessonMaterial', () => {
  it('puts the slide the student is on first and names what they are looking at', () => {
    const asset = pack.assets[2]!;
    const region = asset.regions[0]!;
    const material = lessonMaterial({ pack, assetId: asset.assetId, regionId: region.regionId });
    expect(material).toContain(`The student is on the slide "${asset.title}", looking at "${region.label ?? region.regionId}"`);
    expect(material.indexOf(`Slide: ${asset.title}`)).toBeLessThan(material.indexOf(`Slide: ${pack.assets[0]!.title}`));
    expect(material.length).toBeLessThanOrEqual(CHAT_LIMITS.lessonChars + 400);
  });
});

describe('runChat', () => {
  const turns = [{ role: 'student' as const, text: 'What does the mitochondrion do?' }];

  it('streams the reply through the guardrail in synchronous mode, with the lesson in the system prompt', async () => {
    const bedrock = fakeBedrock(says('It releases usable energy as ATP.'));
    const deps: ChatDeps = { converse: bedrock.converse, modelId: 'us.anthropic.claude-sonnet-4-6', guardrail: { id: 'gr-1', version: '1' } };
    const events = await collect(runChat(turns, { pack }, deps));
    expect(text(events)).toBe('It releases usable energy as ATP.');
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'end_turn' });
    const request = bedrock.requests[0]!;
    expect(request.guardrailConfig).toMatchObject({ guardrailIdentifier: 'gr-1', guardrailVersion: '1', streamProcessingMode: 'sync' });
    expect(request.system[0]!.text).toContain('<lesson_material>');
    expect(request.messages).toEqual([{ role: 'user', content: [{ text: 'What does the mitochondrion do?' }] }]);
    expect(request.toolConfig).toBeUndefined();
  });

  it('reports a guardrail intervention, whose blocked message is the streamed text', async () => {
    const bedrock = fakeBedrock(says("Let's keep our chat about the lesson.", 'guardrail_intervened'));
    const events = await collect(runChat(turns, { pack }, { converse: bedrock.converse, modelId: 'm' }));
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'guardrail' });
  });

  it('offers the course search tool when a knowledge source exists, runs it, and answers from what it found', async () => {
    const bedrock = fakeBedrock(searches('mitochondria ATP'), says('The week 3 notes say mitochondria make ATP.'));
    const knowledge: CourseKnowledge = { search: vi.fn(async () => [{ id: 'kb-9', title: 'Week 3 notes.pdf', text: 'Mitochondria make ATP.', source: 's3://course/week-3/Week 3 notes.pdf' }]) };
    const events = await collect(runChat(turns, { pack, assetId: 'cell-slide-03' }, { converse: bedrock.converse, modelId: 'm', knowledge }));

    expect(knowledge.search).toHaveBeenCalledWith('mitochondria ATP', { packId: 'bio-cell-demo', assetId: 'cell-slide-03' });
    expect(events).toContainEqual({ type: 'sources', sources: [{ id: 'source-1', title: 'Week 3 notes.pdf', source: 's3://course/week-3/Week 3 notes.pdf' }] });
    expect(text(events)).toBe('Let me check the course files. The week 3 notes say mitochondria make ATP.');
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'end_turn' });

    expect(bedrock.requests[0]!.toolConfig).toEqual({ tools: [SEARCH_TOOL] });
    const second = bedrock.requests[1]!.messages;
    expect(second[1]).toEqual({ role: 'assistant', content: [{ text: 'Let me check the course files. ' }, { toolUse: { toolUseId: 'tool-1', name: 'search_course_materials', input: { query: 'mitochondria ATP' } } }] });
    expect(second[2]!.role).toBe('user');
    expect(JSON.stringify(second[2])).toContain('<source id=\\"source-1\\" title=\\"Week 3 notes.pdf\\">');
  });

  it('stops searching after the round limit, and tells the model when a search fails', async () => {
    const endless = fakeBedrock(searches('a', 't1'), searches('b', 't2'), searches('c', 't3'));
    const failing: CourseKnowledge = { search: vi.fn(async () => { throw new Error('KB down'); }) };
    const events = await collect(runChat(turns, { pack }, { converse: endless.converse, modelId: 'm', knowledge: failing }));
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'search_limit' });
    expect(failing.search).toHaveBeenCalledTimes(CHAT_LIMITS.toolRounds);
    expect(JSON.stringify(endless.requests[1]!.messages.at(-1))).toContain('"status":"error"');
  });

  it('throws when Bedrock reports an error in the stream', async () => {
    const broken = fakeBedrock([{ throttlingException: { message: 'slow down' } }]);
    await expect(collect(runChat(turns, { pack }, { converse: broken.converse, modelId: 'm' }))).rejects.toThrow();
  });
});

describe('bedrockKnowledgeBase', () => {
  it('turns Retrieve results into titled, bounded passages from the S3 files', async () => {
    const retrieve = vi.fn(async () => ({
      retrievalResults: [
        { content: { text: 'x'.repeat(5000) }, location: { s3Location: { uri: 's3://courses/bio-101/week%203/Cell%20notes.pdf' } } },
        { content: { text: '' } },
        { content: { text: 'No location.' } },
      ],
    }));
    const passages = await bedrockKnowledgeBase('KB123', retrieve).search('cells', { packId: 'p' });
    expect(retrieve).toHaveBeenCalledWith({ knowledgeBaseId: 'KB123', retrievalQuery: { text: 'cells' }, retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 5 } } });
    expect(passages).toHaveLength(2);
    expect(passages[0]).toMatchObject({ title: 'Cell notes.pdf', source: 's3://courses/bio-101/week%203/Cell%20notes.pdf' });
    expect(passages[0]!.text).toHaveLength(1500);
    expect(passages[1]).toMatchObject({ title: 'Course material' });
  });
});

describe('createPackLoader', () => {
  const published = { packId: 'introduction-to-hnsw', version: 1, title: 'Introduction to HNSW', review: { status: 'instructor-reviewed' }, assets: [{ assetId: 'slide-01', title: 'How HNSW Works', regions: [{ regionId: 'diagram', shortDescription: 'Layers.', plainLanguage: 'Stacked graphs.' }] }] };

  it('prefers the bundled pack, then loads a published instructor-reviewed pack once', async () => {
    const fetchPublished = vi.fn(async () => published);
    const load = createPackLoader(fetchPublished);
    expect((await load('bio-cell-demo', 1))?.packId).toBe('bio-cell-demo');
    expect((await load('introduction-to-hnsw', 1))?.title).toBe('Introduction to HNSW');
    await load('introduction-to-hnsw', 1);
    expect(fetchPublished).toHaveBeenCalledTimes(1);
  });

  it('refuses drafts, mismatched or malformed packs, unsafe ids, and fetch failures', async () => {
    expect(await createPackLoader(async () => ({ ...published, review: { status: 'draft' } }))('introduction-to-hnsw', 1)).toBeNull();
    expect(await createPackLoader(async () => ({ ...published, version: 2 }))('introduction-to-hnsw', 1)).toBeNull();
    expect(await createPackLoader(async () => ({ ...published, assets: [{ assetId: 'x' }] }))('introduction-to-hnsw', 1)).toBeNull();
    const fetchPublished = vi.fn(async () => published);
    expect(await createPackLoader(fetchPublished)('../../secrets', 1)).toBeNull();
    expect(fetchPublished).not.toHaveBeenCalled();
    expect(await createPackLoader(async () => { throw new Error('offline'); })('introduction-to-hnsw', 1)).toBeNull();
    expect(await createPackLoader()('introduction-to-hnsw', 1)).toBeNull();
  });
});

describe('chat handler', () => {
  function response() {
    const lines: string[] = [];
    let status = 0;
    const r: ChatResponse = { start: s => { status = s; }, write: line => lines.push(line), end: () => undefined };
    return { r, lines: () => lines.map(l => JSON.parse(l)), status: () => status };
  }
  const setup = (converse = fakeBedrock(says('Hello there.')).converse) => createChatHandler({ secret: SECRET, now: () => NOW, chat: { converse, modelId: 'm' } });
  const post = (body: unknown) => ({ body: JSON.stringify(body), requestContext: { http: { method: 'POST' } } });
  const valid = { capability: student, packId: 'bio-cell-demo', packVersion: 1, assetId: 'cell-slide-03', turns: [{ role: 'student', text: 'Hi' }] };

  it('streams a reply as JSON lines to a student in a live session', async () => {
    const out = response();
    await setup()(post(valid), out.r);
    expect(out.status()).toBe(200);
    expect(out.lines().map(e => e.type)).toEqual(['delta', 'delta', 'done']);
  });

  it('refuses before streaming: no capability, forged capability, unreviewed pack, bad turns, bad body', async () => {
    const cases: Array<[unknown, number]> = [
      [{ ...valid, capability: undefined }, 401],
      [{ ...valid, capability: { ...student, token: 'forged' } }, 401],
      [{ ...valid, packId: 'unknown' }, 404],
      [{ ...valid, turns: [] }, 400],
    ];
    for (const [body, status] of cases) {
      const out = response();
      await setup()(post(body), out.r);
      expect(out.status()).toBe(status);
      expect(out.lines()).toHaveLength(1);
    }
    const bad = response();
    await setup()({ body: 'not json' }, bad.r);
    expect(bad.status()).toBe(400);
  });

  it('rate-limits one session, and ends the stream with an error event when Bedrock fails mid-reply', async () => {
    const handle = setup();
    const statuses: number[] = [];
    for (let i = 0; i <= CHAT_MESSAGES_PER_MINUTE; i++) {
      const out = response();
      await handle(post(valid), out.r);
      statuses.push(out.status());
    }
    expect(statuses.at(-1)).toBe(429);

    const out = response();
    await setup(fakeBedrock([{ internalServerException: {} }]).converse)(post(valid), out.r);
    expect(out.status()).toBe(200);
    expect(out.lines().at(-1)).toEqual({ type: 'error', reason: 'chat-unavailable' });
  });

  it('never logs what the student or the model wrote', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => { logged.push(line); });
    const out = response();
    await setup(fakeBedrock(says('secret model words')).converse)(post({ ...valid, turns: [{ role: 'student', text: 'private student question' }] }), out.r);
    spy.mockRestore();
    expect(logged.join('\n')).toContain('"route":"chat"');
    expect(logged.join('\n')).not.toMatch(/private student question|secret model words/);
  });
});
