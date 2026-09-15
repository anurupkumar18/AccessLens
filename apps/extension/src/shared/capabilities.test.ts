import {describe,it,expect} from 'vitest';
import {RoleCapabilitySchema, SessionMessageSchema} from './contracts';

const validCapability = {
  schemaVersion: '1.0' as const,
  sessionId: 'demo-session',
  role: 'instructor' as const,
  issuedAt: '2026-09-15T15:00:00Z',
  expiresAt: '2026-09-15T16:00:00Z',
  token: 'signed-opaque-token',
};

describe('RoleCapabilitySchema', () => {
  it('accepts a valid signed role capability', () => {
    expect(RoleCapabilitySchema.safeParse(validCapability).success).toBe(true);
  });

  it('rejects a role outside instructor/student', () => {
    expect(RoleCapabilitySchema.safeParse({...validCapability, role: 'admin'}).success).toBe(false);
  });

  it('rejects a capability missing its signed token', () => {
    const {token, ...withoutToken} = validCapability;
    expect(RoleCapabilitySchema.safeParse(withoutToken).success).toBe(false);
  });

  it.each(['studentId','studentName','email','diagnosis','grade','attentionScore'])(
    'rejects a %s field on a role capability',
    (field) => {
      expect(RoleCapabilitySchema.safeParse({...validCapability, [field]: 'x'}).success).toBe(false);
    }
  );
});

describe('SessionMessageSchema create/close', () => {
  it('accepts a create message naming only a sessionId', () => {
    expect(SessionMessageSchema.safeParse({kind: 'create', sessionId: 'demo-session'}).success).toBe(true);
  });

  it('accepts a close message naming only a sessionId', () => {
    expect(SessionMessageSchema.safeParse({kind: 'close', sessionId: 'demo-session'}).success).toBe(true);
  });

  it('rejects a create message carrying a role', () => {
    expect(SessionMessageSchema.safeParse({kind: 'create', sessionId: 'demo-session', role: 'instructor'}).success).toBe(false);
  });
});
