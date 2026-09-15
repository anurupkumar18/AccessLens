// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RoleNav } from './RoleNav';

describe('RoleNav', () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('marks the active role current for assistive technology', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<RoleNav role="instructor" onSelect={() => {}} />));
    const instructorButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Instructor');
    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student');
    expect(instructorButton?.getAttribute('aria-current')).toBe('true');
    expect(studentButton?.getAttribute('aria-current')).toBe('false');
  });

  it('calls onSelect with the clicked role', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();
    act(() => root.render(<RoleNav role="instructor" onSelect={onSelect} />));
    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith('student');
  });
});
