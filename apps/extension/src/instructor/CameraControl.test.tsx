// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import type { CaptureHost, CaptureStream } from '../sources/screen';
import { CameraControl } from './CameraControl';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeStream(): CaptureStream & { end(): void; stopped: ReturnType<typeof vi.fn> } {
  const listeners = new Set<() => void>();
  const stopped = vi.fn();
  return {
    sampleFrame: () => null,
    stop: stopped,
    onEnded(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    videoTrack: () => null,
    end() { listeners.forEach((listener) => listener()); },
    stopped,
  };
}

describe('CameraControl', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });

  function render(host: CaptureHost): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<CameraControl host={host} />));
  }

  const button = (name: string) => Array.from(container!.querySelectorAll('button')).find((candidate) => candidate.textContent === name)!;

  it('starts only from the explicit control, remains local, and stops tracks', async () => {
    const stream = fakeStream();
    const requestStream = vi.fn(async () => stream);
    render({ requestStream });
    expect(requestStream).not.toHaveBeenCalled();
    await act(async () => button('Start local camera').click());
    expect(requestStream).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain('Camera is on locally');
    expect(container!.textContent).toContain('not sent to students or the relay');
    await act(async () => button('Stop local camera').click());
    expect(stream.stopped).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain('Camera stopped. No camera stream is active.');
  });

  it('reports denial without inventing a source', async () => {
    render({ requestStream: vi.fn(async () => { throw new Error('Permission denied'); }) });
    await act(async () => button('Start local camera').click());
    expect(container!.textContent).toContain('Camera unavailable: Permission denied');
  });

  it('reports browser-ended capture without inventing a source', async () => {
    const stream = fakeStream();
    render({ requestStream: vi.fn(async () => stream) });
    await act(async () => button('Start local camera').click());
    act(() => stream.end());
    expect(container!.textContent).toContain('The browser ended the camera. No camera stream is active.');
  });

  it('has no automatically detectable accessibility violations while on', async () => {
    const stream = fakeStream();
    render({ requestStream: vi.fn(async () => stream) });
    await act(async () => button('Start local camera').click());
    const result = await axe.run(container!, {
      rules: { region: { enabled: false }, 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
