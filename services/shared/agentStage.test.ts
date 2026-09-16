import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import {
  runAgentStage, loadSystemPrompt, toolInputSchema, issueLines, coerceJsonStrings,
  AgentStageError, AGENT_MODEL, type MessagesClient,
} from './agentStage';

const Out = z.object({
  title: z.string().min(1).max(20),
  count: z.number().int().positive(),
  notes: z.string().default(''),
}).strict();

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'viz-prompts-'));
  writeFileSync(join(dir, 'pack-author.md'), [
    '# Pack Author', '', 'Prose a reviewer reads but the model never pays for.', '',
    '<!-- system-prompt -->', '```text', 'THE REAL SYSTEM PROMPT', '```', '',
    'More prose after the block.',
  ].join('\n'));
  writeFileSync(join(dir, 'critic.md'), '# Critic\n\n```\nFIRST FENCE\n```\n');
  writeFileSync(join(dir, 'adapter.md'), '# Adapter\n\nNo fence at all.\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A scripted Bedrock. Each element is one response's tool input, or null for "no tool call". */
function fakeClient(script: (unknown | null)[], toolName = 'submit', stopReasons: (string | undefined)[] = []) {
  const calls: Record<string, unknown>[] = [];
  const client: MessagesClient = {
    messages: {
      async create(body) {
        calls.push(body);
        const i = calls.length - 1;
        const stop_reason = stopReasons[i];
        if (stop_reason === 'max_tokens') return { content: [], stop_reason };
        const next = script[i];
        if (next === null || next === undefined) return { content: [{ type: 'text' }], stop_reason: 'end_turn' };
        return { content: [{ type: 'tool_use', name: toolName, input: next }], stop_reason: 'tool_use' };
      },
    },
  };
  return { client, calls };
}

const call = (over: Partial<Parameters<typeof runAgentStage>[0]> = {}) => ({
  role: 'pack-author' as const,
  toolName: 'submit',
  toolDescription: 'submit it',
  schema: Out,
  userText: 'describe this',
  ...over,
});

describe('loadSystemPrompt', () => {
  it('sends only the marked block, not the surrounding rationale', () => {
    expect(loadSystemPrompt('pack-author', dir)).toBe('THE REAL SYSTEM PROMPT');
  });

  it('falls back to the first fence when the file has no marker', () => {
    expect(loadSystemPrompt('critic', dir)).toBe('FIRST FENCE');
  });

  it('throws rather than sending an empty system prompt', () => {
    expect(() => loadSystemPrompt('adapter', dir)).toThrow(/no fenced system prompt/);
  });
});

describe('toolInputSchema', () => {
  it('derives the tool schema from the same Zod schema the Lambda validates with', () => {
    const schema = toolInputSchema(Out) as any;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(['count', 'notes', 'title']);
  });

  it('does not require a field that has a default, so the model need not restate it', () => {
    expect((toolInputSchema(Out) as any).required).not.toContain('notes');
  });

  it('strips the $schema key that would confuse the tool definition', () => {
    expect(toolInputSchema(Out)).not.toHaveProperty('$schema');
  });

  it('carries the constraints through, so the model is told the caps up front', () => {
    expect((toolInputSchema(Out) as any).properties.title.maxLength).toBe(20);
  });
});

describe('runAgentStage', () => {
  it('returns validated output on the first attempt', async () => {
    const { client, calls } = fakeClient([{ title: 'ok', count: 2 }]);
    const result = await runAgentStage(call(), client, dir);
    expect(result.value).toEqual({ title: 'ok', count: 2, notes: '' });
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('forces the tool call and names the only invokable model', async () => {
    const { client, calls } = fakeClient([{ title: 'ok', count: 1 }]);
    await runAgentStage(call(), client, dir);
    expect(calls[0].model).toBe(AGENT_MODEL);
    expect(calls[0].tool_choice).toEqual({ type: 'tool', name: 'submit' });
    expect(calls[0].system).toBe('THE REAL SYSTEM PROMPT');
  });

  it('repairs on the second attempt by telling the model exactly what failed', async () => {
    const { client, calls } = fakeClient([
      { title: 'x'.repeat(50), count: 2 },
      { title: 'short enough', count: 2 },
    ]);
    const result = await runAgentStage(call(), client, dir);
    expect(result.attempts).toBe(2);
    expect(result.issues).toHaveLength(1);

    const retryTurn = (calls[1].messages as any)[0].content;
    const note = retryTurn[retryTurn.length - 1].text as string;
    expect(note).toContain('failed validation');
    expect(note).toContain('title');
  });

  it('hands the previous answer back and asks for a local edit, not a fresh one', async () => {
    const { client, calls } = fakeClient([
      { title: 'x'.repeat(50), count: 2 },
      { title: 'short enough', count: 2 },
    ]);
    await runAgentStage(call(), client, dir);
    const retryTurn = (calls[1].messages as any)[0].content;
    const note = retryTurn[retryTurn.length - 1].text as string;
    // Without this the model regenerates, fixing the flagged field and
    // breaking a different one -- observed oscillating until the budget ran out.
    expect(note).toContain('Here is exactly what you sent');
    expect(note).toContain('"count":2');
    expect(note).toContain('leaving every other field byte-for-byte identical');
  });

  it('gives up after three attempts rather than returning something unvalidated', async () => {
    const { client, calls } = fakeClient([
      { title: '', count: 0 }, { title: '', count: 0 }, { title: '', count: 0 },
    ]);
    await expect(runAgentStage(call(), client, dir)).rejects.toBeInstanceOf(AgentStageError);
    expect(calls).toHaveLength(3);
  });

  it('carries every attempt\'s issues on the error, so a stage failure is diagnosable', async () => {
    const { client } = fakeClient([{ count: 1 }, { count: 1 }, { count: 1 }]);
    const error = await runAgentStage(call({ logId: 'slide-03' }), client, dir).catch(e => e);
    expect(error).toBeInstanceOf(AgentStageError);
    expect(error.issues).toHaveLength(3);
    expect(error.message).toContain('slide-03');
  });

  it('retries when the model answers with prose instead of calling the tool', async () => {
    const { client } = fakeClient([null, { title: 'ok', count: 1 }]);
    const result = await runAgentStage(call(), client, dir);
    expect(result.attempts).toBe(2);
    expect(result.issues[0][0]).toContain('no tool call');
  });

  it('ignores a tool call with the wrong name, which is a malformed answer not a valid one', async () => {
    const { client } = fakeClient([{ title: 'ok', count: 1 }], 'some_other_tool');
    await expect(runAgentStage(call(), client, dir)).rejects.toBeInstanceOf(AgentStageError);
  });

  it('puts images before the text turn, matching the working build-pack.ts call', async () => {
    const { client, calls } = fakeClient([{ title: 'ok', count: 1 }]);
    await runAgentStage(call({ images: [{ mediaType: 'image/png', base64: 'AAA' }] }), client, dir);
    const content = (calls[0].messages as any)[0].content;
    expect(content[0].type).toBe('image');
    expect(content[0].source.media_type).toBe('image/png');
    expect(content[1].type).toBe('text');
  });

  it('never mutates the base turn between attempts, so attempt three still has the image', async () => {
    const { client, calls } = fakeClient([null, null, { title: 'ok', count: 1 }]);
    await runAgentStage(call({ images: [{ mediaType: 'image/png', base64: 'AAA' }] }), client, dir);
    const third = (calls[2].messages as any)[0].content;
    expect(third.filter((b: any) => b.type === 'image')).toHaveLength(1);
    expect(third.filter((b: any) => b.type === 'text')).toHaveLength(2);
  });
});

describe('issueLines', () => {
  it('names the path and the reason, which is what the retry turn needs', () => {
    const error = Out.safeParse({ title: '', count: -1 }).error!;
    const lines = issueLines(error);
    expect(lines.some(l => l.startsWith('title:'))).toBe(true);
    expect(lines.some(l => l.startsWith('count:'))).toBe(true);
  });
});

describe('coerceJsonStrings — a transport repair, not a leniency', () => {
  it('parses a structured argument the model sent as a JSON string', () => {
    // Observed against real slides: `regions` came back as a string on 2 of 8,
    // and all three attempts died on the same unactionable issue.
    expect(coerceJsonStrings({ regions: '[{"regionId":"a"}]' })).toEqual({ regions: [{ regionId: 'a' }] });
  });

  it('leaves a string that is not JSON exactly as it came, so the error stays honest', () => {
    expect(coerceJsonStrings({ title: 'A three-layer graph' })).toEqual({ title: 'A three-layer graph' });
    expect(coerceJsonStrings({ regions: '[ broken' })).toEqual({ regions: '[ broken' });
  });

  it('touches nothing that is already structured', () => {
    const input = { regions: [{ regionId: 'a' }], count: 3, ok: true };
    expect(coerceJsonStrings(input)).toEqual(input);
  });

  it('passes non-objects straight through', () => {
    expect(coerceJsonStrings(null)).toBeNull();
    expect(coerceJsonStrings([1, 2])).toEqual([1, 2]);
  });

  it('does not make an invalid payload valid — the schema still decides', async () => {
    const { client } = fakeClient([{ title: 'ok', count: '[1,2]' }, { title: 'ok', count: '[1,2]' }, { title: 'ok', count: '[1,2]' }]);
    await expect(runAgentStage(call(), client, dir)).rejects.toBeInstanceOf(AgentStageError);
  });

  it('lets a stringified array through to a successful parse end to end', async () => {
    const Wrapper = z.object({ items: z.array(z.string()).min(1) }).strict();
    const { client } = fakeClient([{ items: '["a","b"]' }]);
    const result = await runAgentStage(call({ schema: Wrapper }), client, dir);
    expect(result.value).toEqual({ items: ['a', 'b'] });
  });
});

describe('a truncated answer is named, not left as a type error', () => {
  it('tells the model its answer was cut off and asks for something that fits', async () => {
    const { client, calls } = fakeClient([null, { title: 'ok', count: 1 }], 'submit', ['max_tokens']);
    const result = await runAgentStage(call(), client, dir);
    expect(result.attempts).toBe(2);
    expect(result.issues[0][0]).toContain('cut off');

    const retryTurn = (calls[1].messages as any)[0].content;
    const note = retryTurn[retryTurn.length - 1].text as string;
    expect(note).toContain('cut off');
    expect(note).toContain('fewer regions');
  });

  it('gives up cleanly if every attempt truncates', async () => {
    const { client } = fakeClient([null, null, null], 'submit', ['max_tokens', 'max_tokens', 'max_tokens']);
    const error = await runAgentStage(call(), client, dir).catch(e => e);
    expect(error).toBeInstanceOf(AgentStageError);
    expect(error.issues.every((a: string[]) => a[0].includes('cut off'))).toBe(true);
  });

  it('requests a budget generous enough for a six-region slide', async () => {
    const { client, calls } = fakeClient([{ title: 'ok', count: 1 }]);
    await runAgentStage(call(), client, dir);
    expect(calls[0].max_tokens).toBeGreaterThanOrEqual(8192);
  });
});
