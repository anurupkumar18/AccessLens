import { describe, it, expect } from 'vitest';
import { LiveEventSchema, type LiveEvent } from './contracts';
import { BroadcastSessionClient } from './broadcastSessionClient';
import { validEvent, invalidEvent } from './fixtures';

const flush = () => new Promise(r => setTimeout(r, 20));

describe('BroadcastSessionClient (local demo transport, same browser profile)', () => {
  it('delivers an instructor event to a student client that joined the same session in another context', async () => {
    const instructor = new BroadcastSessionClient();
    const student = new BroadcastSessionClient();
    const received: LiveEvent[] = [];
    const cap = await instructor.create('ROOM1');
    expect(cap.role).toBe('instructor');
    const joined = await student.join('ROOM1');
    expect(joined.role).toBe('student');
    student.subscribe(e => received.push(e));
    instructor.send({ ...validEvent, sessionId: 'ROOM1' });
    await flush();
    expect(received).toHaveLength(1);
    expect(LiveEventSchema.safeParse(received[0]).success).toBe(true);
    instructor.close(); student.close();
  });

  it('does not leak events across sessions and rejects invalid events before they leave the device', async () => {
    const instructor = new BroadcastSessionClient();
    const other = new BroadcastSessionClient();
    const received: LiveEvent[] = [];
    await instructor.create('ROOM2');
    await other.join('ROOM3');
    other.subscribe(e => received.push(e));
    expect(() => instructor.send(invalidEvent as LiveEvent)).toThrow();
    instructor.send({ ...validEvent, sessionId: 'ROOM2' });
    await flush();
    expect(received).toEqual([]);
    instructor.close(); other.close();
  });

  it('fans out locally too, and refuses to send after close', async () => {
    const client = new BroadcastSessionClient();
    const received: LiveEvent[] = [];
    await client.create('ROOM4');
    client.subscribe(e => received.push(e));
    client.send({ ...validEvent, sessionId: 'ROOM4' });
    expect(received).toHaveLength(1);
    client.close();
    expect(() => client.send({ ...validEvent, sessionId: 'ROOM4' })).toThrow(/closed/);
  });
});
