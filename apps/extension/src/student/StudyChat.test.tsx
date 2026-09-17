// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import type { RoleCapability } from '../shared/contracts';
import { ChatUnavailableError, type ChatClient, type ChatEvent, type ChatRequest } from '../shared/chatClient';
import { validPack } from '../shared/fixtures';
import { StudyChat } from './StudyChat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capability: RoleCapability = { schemaVersion: '1.0', sessionId: 'S1', role: 'student', issuedAt: '2026-09-16T18:00:00.000Z', expiresAt: '2026-09-16T22:00:00.000Z', token: 'signed-by-relay' };

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

/** A chat client that replies with each script in turn, recording what it was sent. */
function scripted(...scripts: Array<ChatEvent[] | Error>) {
  const requests: ChatRequest[] = [];
  const client: ChatClient = {
    send: vi.fn(async (request: ChatRequest, onEvent: (event: ChatEvent) => void) => {
      requests.push(structuredClone(request));
      const script = scripts.shift() ?? [{ type: 'done', stop: 'end_turn' }];
      if (script instanceof Error) throw script;
      for (const event of script) onEvent(event);
    }),
  };
  return { client, requests };
}

function render(client: ChatClient | null, cap: RoleCapability | null = capability): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<StudyChat pack={validPack} capability={cap} client={client} assetId="cell-slide-03" regionId="mitochondrion" />));
}

const input = () => container!.querySelector<HTMLTextAreaElement>('#study-chat-input')!;
async function type(text: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function pressEnter(shiftKey = false): Promise<void> {
  await act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true })); });
}
const messages = () => [...container!.querySelectorAll('.chat-message')].map(m => m.textContent);
const announced = () => container!.querySelector('[aria-live="polite"]')!.textContent;

describe('StudyChat', () => {
  it('asks the student to join before chatting', () => {
    render(scripted().client, null);
    expect(container!.textContent).toContain('Join your class');
    expect(container!.querySelector('#study-chat-input')).toBeNull();
  });

  it('sends on Enter with the slide the student is on, streams the reply, and announces it once finished', async () => {
    const chat = scripted([{ type: 'delta', text: 'Mitochondria ' }, { type: 'delta', text: 'make ATP.' }, { type: 'done', stop: 'end_turn' }]);
    render(chat.client);
    expect(container!.textContent).toContain(`Chatting about ${validPack.assets[0].title}`);
    await type('What do mitochondria do?');
    await pressEnter(true);
    expect(chat.client.send).not.toHaveBeenCalled();
    await pressEnter();
    expect(chat.requests[0]).toMatchObject({ packId: validPack.packId, assetId: 'cell-slide-03', regionId: 'mitochondrion', turns: [{ role: 'student', text: 'What do mitochondria do?' }] });
    expect(messages()).toEqual(['YouWhat do mitochondria do?', 'Study chatMitochondria make ATP.']);
    expect(announced()).toBe('Study chat replied: Mitochondria make ATP.');
    expect(input().value).toBe('');
    // The log itself is not a live region: fragments of a streaming reply are not read out.
    expect(container!.querySelector('[role="log"]')!.getAttribute('aria-live')).toBe('off');
  });

  it('shows course-file sources, and sends earlier answers as context but never a blocked exchange', async () => {
    const chat = scripted(
      [{ type: 'delta', text: 'The lab handout says no.' }, { type: 'sources', sources: [{ id: 'source-1', title: 'Week 3 lab handout.pdf' }] }, { type: 'done', stop: 'end_turn' }],
      [{ type: 'delta', text: "I can't help with that one." }, { type: 'done', stop: 'guardrail' }],
      [{ type: 'delta', text: 'Sure.' }, { type: 'done', stop: 'end_turn' }],
    );
    render(chat.client);
    for (const question of ['Can we see mitochondria in lab?', 'something blocked', 'Quiz me']) {
      await type(question);
      await pressEnter();
    }
    expect(container!.textContent).toContain('From your course filesWeek 3 lab handout.pdf');
    expect(container!.textContent).toContain('Filtered by the chat’s safety guardrail.');
    expect(chat.requests[2]!.turns).toEqual([
      { role: 'student', text: 'Can we see mitochondria in lab?' },
      { role: 'assistant', text: 'The lab handout says no.' },
      { role: 'student', text: 'Quiz me' },
    ]);
  });

  it('explains a refusal and retries the same question', async () => {
    const chat = scripted(new ChatUnavailableError(429, 'rate-limited'), [{ type: 'delta', text: 'Here you go.' }, { type: 'done', stop: 'end_turn' }]);
    render(chat.client);
    await type('Explain osmosis');
    await pressEnter();
    expect(container!.textContent).toContain('You are sending messages quickly.');
    const retry = [...container!.querySelectorAll('button')].find(b => b.textContent === 'Try again')!;
    await act(async () => retry.click());
    expect(chat.requests[1]!.turns).toEqual([{ role: 'student', text: 'Explain osmosis' }]);
    expect(messages()).toEqual(['YouExplain osmosis', 'Study chatHere you go.']);
  });

  it('starts from a suggestion, clears with New chat, and has no detectable accessibility violations', async () => {
    const chat = scripted([{ type: 'delta', text: 'A cell is like a tiny factory.' }, { type: 'done', stop: 'end_turn' }]);
    render(chat.client);
    const suggestion = [...container!.querySelectorAll('.study-chat-suggestions button')][0] as HTMLButtonElement;
    await act(async () => suggestion.click());
    expect(chat.requests[0]!.turns[0]!.text).toBe('Explain this slide in simple words');
    const results = await axe.run(container!);
    expect(results.violations.map(v => v.id)).toEqual([]);
    const newChat = [...container!.querySelectorAll('button')].find(b => b.textContent === 'New chat')!;
    act(() => newChat.click());
    expect(messages()).toEqual([]);
  });
});
