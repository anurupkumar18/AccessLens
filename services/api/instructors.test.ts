import { describe, it, expect } from 'vitest';
import { ensureInstructor } from './instructors';

function fakeTable() {
  const items = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const dynamodb = {
    async send(command: { input: unknown; constructor: { name: string } }) {
      const input = command.input as { Key?: { sub: string }; Item?: Record<string, unknown>; ExpressionAttributeValues?: Record<string, unknown> };
      calls.push(command.constructor.name);
      if (command.constructor.name === 'GetCommand') return { Item: items.get(input.Key!.sub) };
      if (command.constructor.name === 'PutCommand') { items.set(input.Item!.sub as string, input.Item!); return {}; }
      if (command.constructor.name === 'UpdateCommand') {
        const record = items.get(input.Key!.sub)!;
        record.lastSeenAt = input.ExpressionAttributeValues![':now'];
        record.email = input.ExpressionAttributeValues![':email'];
        if (':name' in input.ExpressionAttributeValues!) record.name = input.ExpressionAttributeValues![':name'];
        return {};
      }
      throw new Error(`unexpected ${command.constructor.name}`);
    },
  };
  return { dynamodb, items, calls };
}

describe('ensureInstructor', () => {
  it('creates the record on first sign-in and only touches it afterwards', async () => {
    const table = fakeTable();
    const clock = ['2026-09-16T10:00:00.000Z', '2026-09-16T11:00:00.000Z'];
    const first = await ensureInstructor({ sub: 'g-1', email: 'prof@uni.edu', name: 'Prof' }, { dynamodb: table.dynamodb, tableName: 't', now: () => clock.shift()! });
    expect(first).toEqual({ sub: 'g-1', email: 'prof@uni.edu', name: 'Prof', createdAt: '2026-09-16T10:00:00.000Z', lastSeenAt: '2026-09-16T10:00:00.000Z' });
    const second = await ensureInstructor({ sub: 'g-1', email: 'prof@uni.edu' }, { dynamodb: table.dynamodb, tableName: 't', now: () => clock.shift()! });
    expect(second.createdAt).toBe('2026-09-16T10:00:00.000Z');
    expect(second.lastSeenAt).toBe('2026-09-16T11:00:00.000Z');
    expect(second.name).toBe('Prof');
    expect(table.calls).toEqual(['GetCommand', 'PutCommand', 'GetCommand', 'UpdateCommand']);
    expect(table.items.size).toBe(1);
  });
});
