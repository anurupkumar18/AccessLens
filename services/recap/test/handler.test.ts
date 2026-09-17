/**
 * What the catch-up service promises, asserted rather than trusted.
 *
 * Two things here are worth more than the rest. `summariseTimeline` is where a
 * student is told what they missed, so it is tested as a pure function against
 * the shape of the real demo pack, with no AWS anywhere in the file. And the
 * redaction tests are the only thing standing between a window of lesson
 * captions and CloudWatch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bedrock is mocked at the module boundary so this file never needs
 * credentials, a network, or a model. It also makes "did not call the model" an
 * assertion rather than a claim -- which is the whole point of requirement 5.
 */
// `vi.hoisted` because `vi.mock` is lifted above the imports, so a plain
// `const send` would still be in its temporal dead zone when the factory runs.
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = send;
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { handler, joinCaptions } from '../src/handler.js';
import { coverage, selectTimeline, summariseTimeline, type LiveEvent } from '../src/timeline.js';
import { logEvent, REDACTION_ALLOWLIST } from '../src/log.js';

const NOTICE = 'AI-generated. Not reviewed by your instructor. May be wrong.';

/** Trimmed from `packages/access-packs/bio-cell-demo/pack.json` -- same field
 *  names, same reuse of `nucleus` across two slides. */
const PACK = {
  title: 'Cell Structure',
  assets: [
    {
      assetId: 'cell-slide-01',
      title: 'The Animal Cell',
      regions: [
        {
          regionId: 'cell-membrane',
          label: 'Cell membrane',
          shortDescription: 'The outer boundary of the cell.',
        },
        { regionId: 'nucleus', label: 'Nucleus', shortDescription: 'The control centre.' },
      ],
    },
    {
      assetId: 'cell-slide-03',
      title: 'Energy Release',
      regions: [
        {
          regionId: 'mitochondrion',
          label: 'Mitochondrion',
          shortDescription: 'Releases energy the cell can use.',
        },
      ],
    },
  ],
};

const event = (sequence: number, type: string, extra: Partial<LiveEvent> = {}): LiveEvent => ({
  schemaVersion: '1.0',
  sessionId: 'sess-demo-0001',
  packId: 'bio-cell-demo',
  packVersion: 1,
  sentAt: '2026-09-16T15:00:00Z',
  type,
  sequence,
  ...extra,
});

const TIMELINE: LiveEvent[] = [
  event(1, 'session.started'),
  event(2, 'asset.changed', { assetId: 'cell-slide-01' }),
  event(3, 'region.changed', { assetId: 'cell-slide-01', regionId: 'cell-membrane' }),
  event(4, 'region.changed', { assetId: 'cell-slide-01', regionId: 'nucleus' }),
  event(5, 'asset.changed', { assetId: 'cell-slide-03' }),
  event(6, 'region.changed', { assetId: 'cell-slide-03', regionId: 'mitochondrion' }),
];

const http = (body: unknown, method = 'POST') => ({
  requestContext: { http: { method } },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const parse = (response: { body: string }) => JSON.parse(response.body);

const modelReply = (text: string) => ({
  output: { message: { content: [{ text }] } },
});

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue(modelReply('The class moved to the mitochondrion.'));
});

afterEach(() => vi.restoreAllMocks());

describe('summariseTimeline', () => {
  it('resolves asset and region ids to the human labels in the pack', () => {
    const outline = summariseTimeline(TIMELINE, PACK);

    expect(outline).toContain('Lesson: Cell Structure');
    expect(outline).toContain('Slide: The Animal Cell');
    expect(outline).toContain('Highlighted: Cell membrane. The outer boundary of the cell.');
    expect(outline).toContain('Slide: Energy Release');
    expect(outline).toContain('Releases energy the cell can use.');

    // The raw ids are what the student must never be read out.
    expect(outline).not.toContain('cell-slide-01');
    expect(outline).not.toContain('mitochondrion');
  });

  it('respects sinceSequence and omits everything the student already saw', () => {
    const outline = summariseTimeline(TIMELINE, PACK, 4);

    expect(outline).toContain('Energy Release');
    expect(outline).toContain('Mitochondrion');
    expect(outline).not.toContain('Cell membrane');
    expect(outline).not.toContain('The Animal Cell');
  });

  it('opens a slide heading when the window starts mid-slide', () => {
    // sinceSequence 2 drops the `asset.changed`, which is the normal case: the
    // student looked away after the slide went up.
    const outline = summariseTimeline(TIMELINE, PACK, 2);
    expect(outline.split('\n')[1]).toBe('Slide: The Animal Cell');
  });

  it('tolerates asset and region ids that are not in the pack', () => {
    const outline = summariseTimeline(
      [
        event(2, 'asset.changed', { assetId: 'unapproved-photosynthesis' }),
        event(3, 'region.changed', {
          assetId: 'unapproved-photosynthesis',
          regionId: 'chloroplast',
        }),
        event(4, 'region.changed', { assetId: 'cell-slide-01', regionId: 'golgi-body' }),
      ],
      PACK,
    );

    expect(outline).toContain('Slide: unapproved-photosynthesis (not described in the lesson pack)');
    expect(outline).toContain('Highlighted: chloroplast (not described in the lesson pack)');
    // A known asset with an unknown region degrades on the region alone.
    expect(outline).toContain('Slide: The Animal Cell');
    expect(outline).toContain('Highlighted: golgi-body (not described in the lesson pack)');
  });

  it('works with no pack at all', () => {
    const outline = summariseTimeline(TIMELINE);
    expect(outline).toContain('Slide: cell-slide-01 (not described in the lesson pack)');
    expect(outline).not.toContain('Lesson:');
  });

  it('orders by sequence regardless of array order', () => {
    const shuffled = [TIMELINE[5]!, TIMELINE[2]!, TIMELINE[4]!, TIMELINE[1]!, TIMELINE[3]!];
    expect(summariseTimeline(shuffled, PACK)).toBe(summariseTimeline(TIMELINE, PACK));

    const lines = summariseTimeline(shuffled, PACK).split('\n');
    expect(lines.indexOf('Slide: The Animal Cell')).toBeLessThan(
      lines.indexOf('Slide: Energy Release'),
    );
  });

  it('is empty when there are no events', () => {
    expect(summariseTimeline([], PACK)).toBe('');
    expect(summariseTimeline([], PACK, 0)).toBe('');
  });

  it('is empty when only non-lesson events happened', () => {
    expect(summariseTimeline([event(1, 'session.started'), event(2, 'pointer.moved')], PACK)).toBe(
      '',
    );
  });

  it('is empty when every event predates sinceSequence', () => {
    expect(summariseTimeline(TIMELINE, PACK, 6)).toBe('');
  });

  it('collapses an instructor lingering on one region', () => {
    const lingering = [
      event(2, 'asset.changed', { assetId: 'cell-slide-01' }),
      event(3, 'region.changed', { assetId: 'cell-slide-01', regionId: 'nucleus' }),
      event(4, 'region.changed', { assetId: 'cell-slide-01', regionId: 'nucleus' }),
      event(5, 'region.changed', { assetId: 'cell-slide-01', regionId: 'nucleus' }),
    ];
    const highlights = summariseTimeline(lingering, PACK)
      .split('\n')
      .filter(line => line.includes('Highlighted:'));
    expect(highlights).toHaveLength(1);
  });

  it('emits no markdown characters the screen reader would speak', () => {
    expect(summariseTimeline(TIMELINE, PACK)).not.toMatch(/^\s*[-*#]/m);
  });

  it('is pure: the same input twice gives the same string and does not mutate it', () => {
    const input = [...TIMELINE];
    const first = summariseTimeline(input, PACK, 2);
    const second = summariseTimeline(input, PACK, 2);
    expect(second).toBe(first);
    expect(input).toEqual(TIMELINE);
  });
});

describe('selectTimeline and coverage', () => {
  it('reports the window the recap actually covers', () => {
    expect(coverage(TIMELINE, 3)).toEqual({ fromSequence: 4, toSequence: 6, regionCount: 2 });
  });

  it('reports the caller cursor when the window is empty', () => {
    expect(coverage(TIMELINE, 9)).toEqual({ fromSequence: 9, toSequence: 9, regionCount: 0 });
    expect(coverage([], undefined)).toEqual({ fromSequence: 0, toSequence: 0, regionCount: 0 });
  });

  it('keeps only lesson-moving event types', () => {
    expect(selectTimeline(TIMELINE).map(e => e.sequence)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('joinCaptions', () => {
  it('drops interim results and keeps finals in order', () => {
    expect(
      joinCaptions([
        { text: 'The mito', isFinal: false },
        { text: 'The mitochondrion', isFinal: true },
        { text: 'releases energy.', isFinal: true },
      ]),
    ).toBe('The mitochondrion releases energy.');
  });

  it('is empty for no captions', () => {
    expect(joinCaptions(undefined)).toBe('');
    expect(joinCaptions([{ text: '   ', isFinal: true }])).toBe('');
  });
});

describe('handler', () => {
  it('answers the CORS preflight without touching the model', async () => {
    const response = await handler({ requestContext: { http: { method: 'OPTIONS' } } });
    expect(response.statusCode).toBe(204);
    expect((response.headers as Record<string, string>)['access-control-allow-origin']).toBeUndefined();
    // The Function URL sets CORS. If the handler sets it too the response
    // carries two Access-Control-Allow-Origin headers, browsers reject it
    // outright, and fetch throws -- which a student sees as "could not reach
    // the service". curl never catches this, because curl ignores CORS.
    expect(send).not.toHaveBeenCalled();
  });

  it('returns CORS headers on every response', async () => {
    const response = await handler(http({ events: TIMELINE, pack: PACK }));
    expect((response.headers as Record<string, string>)['access-control-allow-origin']).toBeUndefined();
    // The Function URL sets CORS. If the handler sets it too the response
    // carries two Access-Control-Allow-Origin headers, browsers reject it
    // outright, and fetch throws -- which a student sees as "could not reach
    // the service". curl never catches this, because curl ignores CORS.
  });

  it('says nothing changed without spending a model call', async () => {
    const response = await handler(http({ events: TIMELINE, pack: PACK, sinceSequence: 6 }));
    const body = parse(response);

    expect(response.statusCode).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(body.text).toContain('Nothing has changed');
    expect(body.provenance).toBe('none');
    // Never labelled AI-generated: no AI was involved.
    expect(body.notice).not.toContain('AI-generated');
    expect(body.notice).not.toBe('');
    expect(body.covered).toEqual({ fromSequence: 6, toSequence: 6, regionCount: 0 });
  });

  it('still calls the model when nothing was shown but something was said', async () => {
    // The stretch a deaf student most needs: one slide, four minutes of talking.
    const response = await handler(
      http({ events: [], captions: [{ text: 'Energy comes from respiration.', isFinal: true }] }),
    );
    expect(response.statusCode).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('generates a recap and labels it', async () => {
    send.mockResolvedValue(modelReply('  The class moved on to how the cell makes energy.  '));
    const response = await handler(
      http({
        events: TIMELINE,
        pack: PACK,
        sinceSequence: 3,
        captions: [{ text: 'Now look at the mitochondrion.', isFinal: true }],
      }),
    );
    const body = parse(response);

    expect(response.statusCode).toBe(200);
    expect(body.text).toBe('The class moved on to how the cell makes energy.');
    expect(body.provenance).toBe('generated');
    expect(body.notice).toBe(NOTICE);
    expect(body.covered).toEqual({ fromSequence: 4, toSequence: 6, regionCount: 2 });
  });

  it('sends the outline, the captions and the accessibility instructions to the model', async () => {
    await handler(
      http({
        events: TIMELINE,
        pack: PACK,
        captions: [
          { text: 'discard me', isFinal: false },
          { text: 'Now look at the mitochondrion.', isFinal: true },
        ],
      }),
    );

    const { input } = send.mock.calls[0]![0] as {
      input: {
        modelId: string;
        system: { text: string }[];
        messages: { content: { text: string }[] }[];
      };
    };

    expect(input.modelId).toBe('us.anthropic.claude-sonnet-4-6');

    const prompt = input.messages[0]!.content[0]!.text;
    expect(prompt).toContain('Three sentences at most');
    expect(prompt).toContain('Do not use markdown');
    expect(prompt).toContain('screen reader');
    expect(prompt).toContain('Slide: The Animal Cell');
    expect(prompt).toContain('Now look at the mitochondrion.');
    expect(prompt).not.toContain('discard me');

    const system = input.system[0]!.text;
    expect(system).toContain('instead of inventing');
    expect(system).toContain('Never claim an instructor reviewed');
  });

  it('returns a clean 502 when the model fails, and never throws', async () => {
    send.mockRejectedValue(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const response = await handler(http({ events: TIMELINE, pack: PACK }));

    expect(response.statusCode).toBe(502);
    expect(parse(response).error).toContain('could not reach the model');
    expect((response.headers as Record<string, string>)['access-control-allow-origin']).toBeUndefined();
    // The Function URL sets CORS. If the handler sets it too the response
    // carries two Access-Control-Allow-Origin headers, browsers reject it
    // outright, and fetch throws -- which a student sees as "could not reach
    // the service". curl never catches this, because curl ignores CORS.
  });

  it('returns a clean 502 when the model returns nothing usable', async () => {
    send.mockResolvedValue(modelReply('   '));
    const response = await handler(http({ events: TIMELINE, pack: PACK }));
    expect(response.statusCode).toBe(502);
  });

  it('rejects a malformed body and a wrong method', async () => {
    expect((await handler(http('{not json', 'POST'))).statusCode).toBe(400);
    expect((await handler(http({}, 'GET'))).statusCode).toBe(405);
    expect(send).not.toHaveBeenCalled();
  });

  it('marks the outline as partial rather than letting a huge window look complete', async () => {
    // Far past MAX_OUTLINE_CHARS, and the tail is what the student missed most
    // recently, so the tail is what must survive.
    const many = Array.from({ length: 400 }, (_, i) =>
      event(i + 2, 'region.changed', { assetId: 'cell-slide-01', regionId: `region-${i}` }),
    );
    await handler(http({ events: many, pack: PACK }));

    const { input } = send.mock.calls[0]![0] as {
      input: { messages: { content: { text: string }[] }[] };
    };
    const prompt = input.messages[0]!.content[0]!.text;

    expect(prompt).toContain('earlier beats in this window were omitted');
    expect(prompt).toContain('region-399');
    expect(prompt).not.toContain('region-0 ');
  });

  it('decodes a base64 body', async () => {
    const response = await handler({
      requestContext: { http: { method: 'POST' } },
      isBase64Encoded: true,
      body: Buffer.from(JSON.stringify({ events: TIMELINE, pack: PACK })).toString('base64'),
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('redaction', () => {
  const CONTENT_EVENT = {
    schemaVersion: '1.0',
    type: 'region.changed',
    sessionId: 'sess-demo-0001',
    packId: 'bio-cell-demo',
    packVersion: 1,
    sequence: 4,
    sentAt: '2026-09-16T15:00:24Z',
    assetId: 'cell-slide-03',
    regionId: 'mitochondrion',
    pointer: { x: 0.42, y: 0.58 },
    arState: { hotspotId: 'cell-slide-03:mitochondrion', action: 'focus' },
    caption: 'The mitochondrion releases energy the cell can use.',
  };

  const captured = () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    return {
      last: () => String(info.mock.calls.at(-1)?.[0] ?? ''),
      all: () =>
        [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
          .map(call => String(call[0]))
          .join('\n'),
    };
  };

  it('logs the operational fields', () => {
    const lines = captured();
    logEvent('info', 'recap-pack-mismatch', CONTENT_EVENT, { events: 6 });
    expect(JSON.parse(lines.last())).toMatchObject({
      level: 'info',
      message: 'recap-pack-mismatch',
      type: 'region.changed',
      sessionId: 'sess-demo-0001',
      sequence: 4,
      events: 6,
    });
  });

  it('never logs lesson content', () => {
    const lines = captured();
    logEvent('info', 'recap-pack-mismatch', CONTENT_EVENT);
    const raw = lines.last();

    // Checked as substrings of the raw line, not as absent keys: a nested
    // object would satisfy a key check while still putting the caption in
    // CloudWatch.
    for (const secret of ['mitochondrion', 'cell-slide-03', 'releases energy', '0.42', 'focus']) {
      expect(raw, `leaked ${secret}`).not.toContain(secret);
    }
    const parsed = JSON.parse(raw);
    for (const field of ['assetId', 'regionId', 'pointer', 'arState', 'caption']) {
      expect(parsed).not.toHaveProperty(field);
    }
  });

  it('survives an event carrying a field nobody anticipated', () => {
    const lines = captured();
    logEvent('warn', 'recap-pack-mismatch', {
      ...CONTENT_EVENT,
      frameData: 'data:image/png;base64,iVBORw0KGgo',
      studentId: 'u1529771',
    });
    expect(lines.all()).not.toContain('iVBORw0KGgo');
    expect(lines.all()).not.toContain('u1529771');
  });

  it('logs no captions, outline, or ids across a whole successful request', async () => {
    const lines = captured();
    send.mockResolvedValue(modelReply('The class moved on to how the cell makes energy.'));

    await handler(
      http({
        events: [
          ...TIMELINE,
          event(7, 'region.changed', { assetId: 'secret-slide', regionId: 'secret-region' }),
        ],
        pack: PACK,
        captions: [{ text: 'Mitosis is not on the exam.', isFinal: true }],
      }),
    );

    const raw = lines.all();
    for (const secret of [
      'Mitosis is not on the exam',
      'cell-slide-01',
      'cell-membrane',
      'Cell membrane',
      'secret-slide',
      'secret-region',
      'The Animal Cell',
      'moved on to how the cell',
    ]) {
      expect(raw, `leaked ${secret}`).not.toContain(secret);
    }
  });

  it('logs no content when the model fails', async () => {
    const lines = captured();
    send.mockRejectedValue(new Error('The mitochondrion releases energy.'));
    await handler(http({ events: TIMELINE, pack: PACK }));
    expect(lines.all()).not.toContain('mitochondrion');
    expect(lines.all()).not.toContain('releases energy');
  });

  it('keeps the allowlist to operational fields only', () => {
    // If this fails, someone widened the allowlist. That may be right -- but it
    // is a charter-adjacent decision, so it should be a deliberate edit to this
    // list rather than a side effect. It is also deliberately identical to the
    // relay's list in `services/live-session/src/log.ts`; diverging the two is
    // how one service quietly starts logging what the other refuses to.
    expect([...REDACTION_ALLOWLIST].sort()).toEqual(
      ['packId', 'packVersion', 'sequence', 'sessionId', 'type'].sort(),
    );
  });
});
