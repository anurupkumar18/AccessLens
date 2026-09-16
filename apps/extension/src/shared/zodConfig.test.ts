import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('zodConfig', () => {
  it('sets jitless mode, so Zod never probes eval under the extension CSP', async () => {
    await import('./zodConfig');
    expect(z.config().jitless).toBe(true);
  });
});
