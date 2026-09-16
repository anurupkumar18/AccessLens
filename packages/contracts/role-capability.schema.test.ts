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

  it('rejects a capability missing its signed token', () => {
    const {token, ...withoutToken} = validCapability;
    expect(validate(withoutToken)).toBe(false);
  });

  it('rejects an identity field on a role capability', () => {
    expect(validate({...validCapability, studentEmail: 'a@b.edu'})).toBe(false);
  });
});
