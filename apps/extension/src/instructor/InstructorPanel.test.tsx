// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach } from 'vitest';
import { AccessPackSchema, InMemorySessionClient, type LiveEvent } from '../shared/contracts';
import { InstructorPanel } from './index';
import { FakeCaptureHost, FakeClock, FakeScheduler, fixedIds, loadDemoFrame, loadSlideFrame, testPack } from '../sources/screen/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pack = AccessPackSchema.parse(testPack);
let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

function render(host = new FakeCaptureHost()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const client = new InMemorySessionClient();
  const scheduler = new FakeScheduler();
  const events: LiveEvent[] = [];
  client.subscribe(e => events.push(e));
  root = createRoot(container);
  act(() => root!.render(
    <InstructorPanel client={client} pack={pack} host={host} scheduler={scheduler} clock={new FakeClock()} ids={fixedIds('JOIN42')} />,
  ));
  return { host, client, scheduler, events, stream: host.stream };
}

/** Capture-control buttons only (Start/Pause/Resume/Stop/End Session), not form submit buttons. */
const buttons = () => Array.from(container!.querySelectorAll('[aria-label="Capture controls"] button')).map(b => b.textContent?.trim());
const button = (name: string) => {
  const found = Array.from(container!.querySelectorAll('button')).find(b => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}; have ${buttons().join(', ')}`);
  return found;
};
const click = async (name: string) => act(async () => { button(name).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const status = () => container!.querySelector('[role="status"]')!.textContent ?? '';
const select = (id: string, value: string) => act(() => {
  const el = container!.querySelector<HTMLSelectElement>(`#${id}`)!;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
});

describe('InstructorPanel', () => {
  it('before Start, the host has no calls and only Start is offered', () => {
    const { host } = render();
    expect(host.calls).toEqual([]);
    expect(buttons()).toEqual(['Start']);
    expect(status()).toMatch(/not sharing/i);
    expect(container!.textContent).not.toContain('Join code');
  });

  it('clicking Start calls the host once, reports sharing, shows the join code, and emits session.started', async () => {
    const { host, events } = render();
    await click('Start');
    expect(host.calls).toEqual(['requestStream']);
    expect(status()).toMatch(/sharing/i);
    expect(container!.textContent).toContain('JOIN42');
    expect(events.map(e => e.type)).toEqual(['session.started']);
    expect(buttons()).toEqual(['Pause', 'Stop', 'End Session']);
  });

  it('a denied chooser explains that sharing is required and offers Start again', async () => {
    const { events } = render(FakeCaptureHost.denied());
    await click('Start');
    expect(status()).toMatch(/sharing is required/i);
    expect(buttons()).toEqual(['Start']);
    expect(events).toEqual([]);
  });

  it('names the matched asset title once the sampler recognises a demo-condition frame', async () => {
    const { stream, scheduler } = render();
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-03'));
    act(() => scheduler.tick(1));
    expect(status()).toContain('The mitochondrion');
  });

  it('reads Unmatched after three unknown frames', async () => {
    const { stream, scheduler, events } = render();
    await click('Start');
    stream.enqueue(loadSlideFrame('unknown-01'), loadSlideFrame('unknown-01'), loadSlideFrame('unknown-01'));
    act(() => scheduler.tick(3));
    expect(status()).toContain('Unmatched');
    expect(events.map(e => e.type)).toEqual(['session.started', 'source.unmatched']);
  });

  it('correcting to an asset and region emits asset.changed then region.changed and names the region', async () => {
    const { events } = render();
    await click('Start');
    select('correct-asset', 'slide-04');
    select('correct-region', 'nucleolus');
    await click('Apply correction');
    expect(events.slice(1)).toMatchObject([
      { type: 'asset.changed', assetId: 'slide-04' },
      { type: 'region.changed', assetId: 'slide-04', regionId: 'nucleolus' },
    ]);
    expect(status()).toContain('The nucleus');
    expect(status()).toContain('nucleolus');
  });

  it('indicating a region on the current asset emits region.changed', async () => {
    const { stream, scheduler, events } = render();
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-05'));
    act(() => scheduler.tick(1));
    select('indicate-region', 'reticulum');
    await click('Indicate region');
    expect(events.at(-1)).toMatchObject({ type: 'region.changed', assetId: 'slide-05', regionId: 'reticulum' });
    expect(status()).toContain('reticulum');
  });

  it('Pause, Resume, Stop, and End Session each emit their event and change the button set', async () => {
    const { events, stream } = render();
    await click('Start');
    await click('Pause');
    expect(events.at(-1)?.type).toBe('capture.paused');
    expect(buttons()).toEqual(['Resume', 'Stop', 'End Session']);
    expect(status()).toMatch(/paused/i);
    await click('Resume');
    expect(events.at(-1)?.type).toBe('capture.resumed');
    expect(buttons()).toEqual(['Pause', 'Stop', 'End Session']);
    await click('Stop');
    expect(events.at(-1)?.type).toBe('capture.stopped');
    expect(stream.stopped).toBe(true);
    expect(buttons()).toEqual(['Start', 'End Session']);
    expect(container!.textContent).toContain('JOIN42');
    await click('End Session');
    expect(events.map(e => e.type)).toEqual(['session.started', 'capture.paused', 'capture.resumed', 'capture.stopped', 'session.ended']);
    expect(buttons()).toEqual([]);
    expect(status()).toMatch(/session ended/i);
  });

  it('the browser Stop sharing bar returns the panel to the stopped state', async () => {
    const { stream, events } = render();
    await click('Start');
    act(() => stream.endFromBrowser());
    expect(events.map(e => e.type)).toEqual(['session.started', 'capture.stopped']);
    expect(buttons()).toEqual(['Start', 'End Session']);
  });

  it('every button and form control has an accessible name', async () => {
    const { stream, scheduler } = render();
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-02'));
    act(() => scheduler.tick(1));
    for (const b of Array.from(container!.querySelectorAll('button'))) {
      expect((b.textContent?.trim() || b.getAttribute('aria-label') || '').length).toBeGreaterThan(0);
    }
    const controls = Array.from(container!.querySelectorAll<HTMLElement>('select, input, textarea'));
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const label = control.id ? container!.querySelector(`label[for="${control.id}"]`) : null;
      const named = (label?.textContent?.trim() || control.getAttribute('aria-label') || '').length > 0;
      expect(named, `${control.tagName}#${control.id} has no label`).toBe(true);
    }
  });
});
