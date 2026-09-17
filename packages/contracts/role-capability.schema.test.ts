import {describe,it,expect,beforeAll} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './role-capability.schema.json';

let validate: (data: unknown) => boolean;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  validate = ajv.compile(schema);
});

const validCapability = {
  schemaVersion: '1.0',
  sessionId: 'demo-session',
  role: 'instructor',
  issuedAt: '2026-09-15T15:00:00Z',
  expiresAt: '2026-09-15T16:00:00Z',
  token: 'signed-opaque-token',
};

describe('role-capability.schema.json', () => {
  it('accepts a valid signed role capability', () => {
    expect(validate(validCapability)).toBe(true);
  });

  it('rejects a role outside instructor/student', () => {
    expect(validate({...validCapability, role: 'admin'})).toBe(false);
  });

  it('accepts an optional video stage token and nothing else extra', () => {
    expect(validate({...validCapability, streamToken: 'ivs-participant-token'})).toBe(true);
    expect(validate({...validCapability, streamToken: ''})).toBe(false);
    expect(validate({...validCapability, studentId: 'x'})).toBe(false);
  });

  it('rejects a capability missing its signed token', () => {
    const {token, ...withoutToken} = validCapability;
    expect(validate(withoutToken)).toBe(false);
  });

  it('accepts the relay-issued stream token alongside the signed token', () => {
    expect(validate({...validCapability, streamToken: 'opaque-stream-token'})).toBe(true);
    expect(validate({...validCapability, streamToken: ''})).toBe(false);
  });

  it('rejects an identity field on a role capability', () => {
    expect(validate({...validCapability, studentEmail: 'a@b.edu'})).toBe(false);
  });
});
