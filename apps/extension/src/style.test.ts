import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A CSS custom property (`--ink`) cascades, but `color`/`background` are
 * ordinary inherited properties resolved once where they're declared and
 * passed down as computed pixel values, not as live `var()` references. A
 * scope that only overrides `--ink`/`--paper` does nothing for a descendant
 * that never redeclares `color: var(--ink)` itself -- confirmed live with
 * axe-core in a real browser (jsdom cannot compute this): the "Higher
 * contrast" toggle produced ~1.1:1 contrast in dark mode, the opposite of
 * its purpose, and had zero effect at all on the Review route, which had no
 * matching CSS rule. This is a static regression guard for that class of
 * bug, since jsdom-based component tests cannot see real cascade/contrast.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBodyFor(selectorSubstring: string): string {
  for (const block of css.split('}')) {
    const openIndex = block.indexOf('{');
    if (openIndex === -1) continue;
    if (block.slice(0, openIndex).includes(selectorSubstring)) return block.slice(openIndex + 1);
  }
  throw new Error(`No CSS rule found with a selector containing "${selectorSubstring}"`);
}

describe('high-contrast preference actually applies color/background', () => {
  it.each(['.student-experience.high-contrast', '.review-experience.high-contrast'])(
    '%s declares color and background, not only the --ink/--paper custom properties',
    (selector) => {
      const body = ruleBodyFor(selector);
      expect(body).toMatch(/(?:^|[^-])\bcolor:\s*var\(--ink\)/);
      expect(body).toMatch(/\bbackground:\s*var\(--paper\)/);
    },
  );
});
