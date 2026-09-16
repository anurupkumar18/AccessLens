/**
 * Pulls the readable gist of whatever page the student is on.
 *
 * Deliberately conservative about what leaves the device. Charter A2 keeps raw
 * media local, and the same instinct applies here: the orb sends a bounded
 * extract of visible text, never the DOM, never form values, never anything
 * from a password or hidden field.
 */

const MAX_CHARS = 6000;

const SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS',
  'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'NAV', 'FOOTER',
]);

export interface PageContext {
  readonly title: string;
  readonly url: string;
  readonly selection: string;
  readonly text: string;
  /** True when the student highlighted something; that beats whole-page guessing. */
  readonly fromSelection: boolean;
}

function visible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

function harvest(root: Element, out: string[], budget: { left: number }): void {
  if (budget.left <= 0) return;
  for (const child of Array.from(root.children)) {
    if (budget.left <= 0) return;
    if (SKIP.has(child.tagName)) continue;
    if (child.getAttribute('aria-hidden') === 'true') continue;
    if (!visible(child)) continue;
    if (child.children.length === 0) {
      const text = (child.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (text.length > 1) {
        out.push(text);
        budget.left -= text.length;
      }
    } else {
      harvest(child, out, budget);
    }
  }
}

export function readPageContext(): PageContext {
  const selection = (window.getSelection()?.toString() ?? '').trim().replace(/\s+/g, ' ');

  const main = document.querySelector('main, [role="main"], article') ?? document.body;
  const pieces: string[] = [];
  harvest(main, pieces, { left: MAX_CHARS });

  return {
    title: document.title,
    // Path only. Query strings on an LMS routinely carry session ids.
    url: `${location.origin}${location.pathname}`,
    selection,
    text: (selection || pieces.join('\n')).slice(0, MAX_CHARS),
    fromSelection: selection.length > 0,
  };
}
