// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createDisplayMediaHost } from './index';

describe('displayMediaHost (A1)', () => {
  it('constructing the production host calls nothing; only requestStream reaches getDisplayMedia', () => {
    const getDisplayMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });
    const host = createDisplayMediaHost();
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(typeof host.requestStream).toBe('function');
  });
});
