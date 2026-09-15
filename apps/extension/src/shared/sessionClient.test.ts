import {describe,it,expect} from 'vitest';
import {InMemorySessionClient, RoleCapabilitySchema} from './contracts';
import {validEvent} from './fixtures';

describe('InMemorySessionClient', () => {
  it('issues a valid signed instructor capability on create', async () => {
    const client = new InMemorySessionClient();
    const capability = await client.create('demo-session');
    expect(RoleCapabilitySchema.safeParse(capability).success).toBe(true);
    expect(capability.role).toBe('instructor');
    expect(capability.sessionId).toBe('demo-session');
  });

  it('issues a valid signed student capability on join', async () => {
    const client = new InMemorySessionClient();
    const capability = await client.join('demo-session');
    expect(RoleCapabilitySchema.safeParse(capability).success).toBe(true);
    expect(capability.role).toBe('student');
  });

  it('delivers a sent event to subscribers', () => {
    const client = new InMemorySessionClient();
    let received: unknown = null;
    client.subscribe(e => { received = e; });
    client.send(validEvent);
    expect(received).toEqual(validEvent);
  });

  it('stops delivering events after close, per the documented session-close invariant', () => {
    const client = new InMemorySessionClient();
    let received: unknown = null;
    client.subscribe(e => { received = e; });
    client.close();
    expect(() => client.send(validEvent)).toThrow();
    expect(received).toBeNull();
  });

  it('rejects creating or joining a session after close', async () => {
    const client = new InMemorySessionClient();
    client.close();
    await expect(client.create('demo-session')).rejects.toThrow();
    await expect(client.join('demo-session')).rejects.toThrow();
  });
});
