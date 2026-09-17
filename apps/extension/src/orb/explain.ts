/**
 * Asks the backend to explain the page, and validates what comes back.
 *
 * The extension never holds AWS credentials. `SYSTEM_DESIGN.md` §10 says never
 * to put tokens in the extension bundle, and a bundle that anyone can unzip is
 * exactly the wrong place for them, so the model call happens behind an
 * endpoint that does hold them.
 *
 * Everything returned is treated as untrusted: a model can emit anything, and
 * this content is injected into a page the student is reading. SVG in
 * particular is an active document -- it can carry script and event handlers --
 * so it is sanitised structurally rather than pattern-matched.
 */

import { type Attributed, generated } from './provenance';

export type ExplainMode = 'explain' | 'simplify' | 'diagram';

export interface ExplainRequest {
  readonly mode: ExplainMode;
  readonly title: string;
  readonly url: string;
  readonly text: string;
}

export interface Explanation {
  readonly text: string;
  /** Sanitised inline SVG, or undefined when the model returned none. */
  readonly svg?: string;
}

const ALLOWED_SVG_TAGS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'marker', 'title', 'desc', 'animate', 'animateTransform',
]);

/**
 * Rebuilds the SVG from a parsed tree, keeping only known-safe elements and
 * attributes. Allowlisting the shape of the output beats trying to enumerate
 * what an attacker might send.
 */
export function sanitiseSvg(raw: string): string | undefined {
  if (typeof DOMParser === 'undefined') return undefined;
  const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return undefined;
  const root = parsed.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return undefined;

  const clean = (node: Element): Element | undefined => {
    const tag = node.tagName.toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tag)) return undefined;
    const copy = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      // No event handlers, no xlink (can reference external documents), no
      // javascript: or data: URLs hiding in href/style.
      if (name.startsWith('on') || name.startsWith('xlink:') || name === 'href') continue;
      if (/url\(|javascript:|data:/i.test(attribute.value)) continue;
      copy.setAttribute(attribute.name, attribute.value);
    }
    for (const child of Array.from(node.children)) {
      const cleaned = clean(child);
      if (cleaned) copy.appendChild(cleaned);
    }
    if (node.children.length === 0 && node.textContent) {
      copy.textContent = node.textContent;
    }
    return copy;
  };

  const safe = clean(root);
  if (!safe) return undefined;
  safe.setAttribute('role', 'img');
  return safe.outerHTML;
}

export class ExplainUnavailable extends Error {}

export async function requestExplanation(
  endpoint: string,
  request: ExplainRequest,
  signal?: AbortSignal,
): Promise<Attributed<Explanation>> {
  if (!endpoint) {
    throw new ExplainUnavailable(
      'No explanation service is configured. Set the orb endpoint in AccessLens settings.',
    );
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new ExplainUnavailable(`The explanation service returned ${response.status}.`);
  }

  const payload = (await response.json()) as { text?: unknown; svg?: unknown };
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    throw new ExplainUnavailable('The explanation service returned nothing usable.');
  }

  const svg = typeof payload.svg === 'string' ? sanitiseSvg(payload.svg) : undefined;
  return generated({ text, svg });
}
