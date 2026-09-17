// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createCameraMediaHost } from './cameraMediaHost';

describe('cameraMediaHost (A1/A2/A9)', () => {
  it('constructing the host does not access a camera', () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const host = createCameraMediaHost();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(typeof host.requestStream).toBe('function');
  });
});
