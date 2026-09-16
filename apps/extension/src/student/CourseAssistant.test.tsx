// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomClient } from '../shared/classroomClient';
import { CourseAssistant } from './CourseAssistant';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; window.localStorage.clear(); });

function mount(client: ClassroomClient): void {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); act(() => root!.render(<CourseAssistant client={client} />));
}

async function fill(selector: string, value: string): Promise<void> {
  const input = container!.querySelector<HTMLInputElement>(selector)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('CourseAssistant', () => {
  it('redeems a class invite, asks only that profile, shows citations, and saves a local task', async () => {
    const client = {
      redeemInvite: vi.fn(async () => ({ profileId: 'class-1', studentSub: 'student-1', role: 'student' as const, joinedAt: '2026-09-16T00:00:00.000Z' })),
      ask: vi.fn(async () => ({ status: 'answered' as const, answer: 'Provisional: We covered graph traversal.', provisional: true, citations: [{ docId: 'notes', title: 'Lecture notes', page: 3, quote: 'Recap: 2026-09-16 - We covered graph traversal.', kind: 'fact' as const, provisional: true }] })),
    } satisfies ClassroomClient;
    mount(client);
    await fill('#class-invite', 'a-very-private-invite-code');
    await act(async () => { container!.querySelector<HTMLFormElement>('[aria-label="Redeem class invite"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(client.redeemInvite).toHaveBeenCalledWith('a-very-private-invite-code');
    await fill('#class-question', 'What happened in class?');
    await act(async () => { container!.querySelector<HTMLFormElement>('[aria-label="Ask class library"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(client.ask).toHaveBeenCalledWith('class-1', 'What happened in class?');
    expect(container!.textContent).toContain('Lecture notes (page 3)');
    expect(container!.textContent).toContain('Provisional');
    await act(async () => { [...container!.querySelectorAll('button')].find(button => button.textContent === 'Add as a private task')!.click(); });
    expect(container!.textContent).toContain('What happened in class?');
    expect(window.localStorage.getItem('accesslens.private-class-tasks.v1')).toContain('graph traversal');
  });

  it('shows a decline rather than inventing an unsupported answer', async () => {
    const client = { redeemInvite: vi.fn(), ask: vi.fn(async () => ({ status: 'declined' as const, reason: 'not-supported-by-material' as const })) } satisfies ClassroomClient;
    window.localStorage.setItem('accesslens.classroom.enrollment.v1', JSON.stringify({ profileId: 'class-1', studentSub: 'student-1', role: 'student', joinedAt: '2026-09-16T00:00:00.000Z' }));
    mount(client);
    await fill('#class-question', 'What is the answer to the exam?');
    await act(async () => { container!.querySelector<HTMLFormElement>('[aria-label="Ask class library"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container!.textContent).toContain('do not support an answer');
  });
});
