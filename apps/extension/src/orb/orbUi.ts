/**
 * The floating orb and its panel, built in a shadow root.
 *
 * This runs inside pages nobody on this team controls, which drives two
 * decisions. It is plain DOM rather than React, so it adds no framework to
 * someone else's page; and it lives in a closed shadow root with all styles
 * scoped inside, so it cannot restyle the host page and the host page cannot
 * restyle it.
 *
 * Accessibility is not a feature here, it is the product. The orb is a real
 * button, the panel is a modal dialog with a focus trap and Escape to close,
 * results are announced through a live region, and every animation is dropped
 * when the student asks for reduced motion.
 */

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }

.orb {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  width: 56px; height: 56px; border-radius: 50%; border: 2px solid #fff;
  background: radial-gradient(circle at 32% 30%, #6aa3f0, #2f5fa8 62%, #24487e);
  box-shadow: 0 6px 20px rgba(0,0,0,.35); cursor: pointer; color: #fff;
  font-size: 22px; line-height: 1; display: grid; place-items: center;
  transition: transform .18s ease, box-shadow .18s ease;
}
.orb:hover { transform: scale(1.06); }
.orb:focus-visible { outline: 3px solid #ffb703; outline-offset: 3px; }
.orb[aria-expanded="true"] { transform: scale(.92); }

.panel {
  position: fixed; right: 20px; bottom: 88px; z-index: 2147483647;
  width: min(420px, calc(100vw - 40px)); max-height: min(70vh, 620px);
  overflow-y: auto; background: #fff; color: #14181f;
  border: 1px solid #d7dce5; border-radius: 14px;
  box-shadow: 0 14px 44px rgba(0,0,0,.28); padding: 16px;
}
@media (prefers-color-scheme: dark) {
  .panel { background: #1a1f26; color: #e8ecf2; border-color: #2b323c; }
  .actions button { background: #222933; color: #e8ecf2; border-color: #39424e; }
  .notice { background: #2e2617; border-color: #c9962f; }
  .result { background: #151a21; border-color: #2b323c; }
}
.panel[hidden] { display: none; }

h2 { margin: 0 0 2px; font-size: 1rem; }
.sub { margin: 0 0 12px; font-size: .8rem; opacity: .75; }

.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.actions button {
  flex: 1 1 auto; padding: 9px 12px; font-size: .86rem; font-weight: 600;
  border: 1px solid #c8cfda; border-radius: 9px; background: #f3f6fa;
  color: inherit; cursor: pointer;
}
.actions button:hover:not(:disabled) { border-color: #2f5fa8; }
.actions button:focus-visible { outline: 3px solid #ffb703; outline-offset: 2px; }
.actions button:disabled { opacity: .5; cursor: not-allowed; }

.notice {
  display: flex; gap: 8px; align-items: flex-start;
  background: #fff6e6; border: 1px solid #e0a63c; border-radius: 9px;
  padding: 9px 11px; font-size: .8rem; margin-bottom: 10px;
}
.notice strong { white-space: nowrap; }

.result {
  border: 1px solid #e2e7ef; border-radius: 9px; padding: 12px;
  background: #fafbfd; font-size: .92rem; white-space: pre-wrap;
}
.result svg { max-width: 100%; height: auto; display: block; margin-top: 10px; }
.status { font-size: .82rem; opacity: .8; margin: 8px 0 0; }
.close {
  position: absolute; top: 10px; right: 12px; background: none; border: none;
  font-size: 18px; cursor: pointer; color: inherit; padding: 4px 6px; border-radius: 6px;
}
.close:focus-visible { outline: 3px solid #ffb703; }
@media (prefers-reduced-motion: reduce) {
  .orb, .actions button { transition: none !important; }
  .result svg animate, .result svg animateTransform { display: none; }
}
`;

export interface OrbHandlers {
  onAction(mode: 'explain' | 'simplify' | 'diagram'): void;
  onSpeak(): void;
  onStopSpeaking(): void;
  onClose(): void;
}

export interface OrbView {
  readonly root: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  setBusy(busy: boolean, label?: string): void;
  showResult(notice: string, text: string, svg?: string): void;
  showError(message: string): void;
  setSpeaking(speaking: boolean): void;
  destroy(): void;
}

export function mountOrb(handlers: OrbHandlers, speechAvailable: boolean): OrbView {
  const host = document.createElement('div');
  host.setAttribute('data-accesslens-orb', '');
  // Open, not closed. Closed would stop page scripts reading inside, but they
  // can already see and remove the host node, so it buys little -- while
  // costing the ability to test the accessibility contract and to debug the
  // panel in a live page. For an accessibility product that trade is wrong.
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const orb = document.createElement('button');
  orb.className = 'orb';
  orb.type = 'button';
  orb.textContent = '◐';
  orb.setAttribute('aria-label', 'Open AccessLens explainer');
  orb.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', 'AccessLens explainer');
  panel.hidden = true;
  panel.innerHTML = `
    <button class="close" type="button" aria-label="Close explainer">×</button>
    <h2>Explain this page</h2>
    <p class="sub">Select text first to explain just that part.</p>
    <div class="actions">
      <button type="button" data-mode="explain">Explain</button>
      <button type="button" data-mode="simplify">Simpler words</button>
      <button type="button" data-mode="diagram">Diagram it</button>
    </div>
    <div class="actions">
      <button type="button" data-speak>Read aloud</button>
      <button type="button" data-stop hidden>Stop reading</button>
    </div>
    <p class="status" role="status" aria-live="polite"></p>
    <div class="result" hidden></div>
  `;

  shadow.append(orb, panel);
  document.documentElement.appendChild(host);

  const status = panel.querySelector('.status') as HTMLParagraphElement;
  const result = panel.querySelector('.result') as HTMLDivElement;
  const speakButton = panel.querySelector('[data-speak]') as HTMLButtonElement;
  const stopButton = panel.querySelector('[data-stop]') as HTMLButtonElement;
  const closeButton = panel.querySelector('.close') as HTMLButtonElement;
  speakButton.disabled = !speechAvailable;
  if (!speechAvailable) speakButton.title = 'This browser has no speech voices available.';

  let open = false;

  function focusables(): HTMLElement[] {
    return Array.from(panel.querySelectorAll<HTMLElement>('button:not([hidden]):not(:disabled)'));
  }

  function setOpen(next: boolean) {
    open = next;
    panel.hidden = !next;
    orb.setAttribute('aria-expanded', String(next));
    orb.setAttribute('aria-label', next ? 'Close AccessLens explainer' : 'Open AccessLens explainer');
    // Focus the first action, not the close button that happens to come first
    // in the DOM. Opening a panel and landing on "close" wastes a keyboard
    // user's first keystroke and tells them nothing about what the panel does.
    if (next) (panel.querySelector<HTMLButtonElement>('[data-mode]') ?? focusables()[0])?.focus();
    else orb.focus();
  }

  orb.addEventListener('click', () => (open ? handlers.onClose() : setOpen(true)));
  closeButton.addEventListener('click', () => handlers.onClose());

  panel.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const mode = target.dataset?.mode;
    if (mode === 'explain' || mode === 'simplify' || mode === 'diagram') handlers.onAction(mode);
    else if (target.hasAttribute('data-speak')) handlers.onSpeak();
    else if (target.hasAttribute('data-stop')) handlers.onStopSpeaking();
  });

  // Escape closes; Tab is trapped so keyboard users cannot fall out of the
  // panel into the host page without meaning to.
  shadow.addEventListener('keydown', event => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Escape' && open) {
      event.preventDefault();
      handlers.onClose();
      return;
    }
    if (key !== 'Tab' || !open) return;
    const items = focusables();
    if (items.length === 0) return;
    const active = shadow.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    const shift = (event as KeyboardEvent).shiftKey;
    const next = shift ? index - 1 : index + 1;
    if (next < 0 || next >= items.length) {
      event.preventDefault();
      items[shift ? items.length - 1 : 0].focus();
    }
  });

  return {
    root: host,
    get isOpen() {
      return open;
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    setBusy(busy, label) {
      status.textContent = busy ? (label ?? 'Working…') : '';
      panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => (b.disabled = busy));
    },
    showResult(notice, text, svg) {
      result.hidden = false;
      result.textContent = '';
      const banner = document.createElement('div');
      banner.className = 'notice';
      banner.innerHTML = '<strong>Heads up:</strong><span></span>';
      (banner.querySelector('span') as HTMLElement).textContent = notice;
      const body = document.createElement('div');
      body.textContent = text;
      result.append(banner, body);
      if (svg) {
        const figure = document.createElement('div');
        // Already structurally sanitised in explain.ts.
        figure.innerHTML = svg;
        result.appendChild(figure);
      }
      status.textContent = 'Ready.';
    },
    showError(message) {
      result.hidden = false;
      result.textContent = message;
      status.textContent = '';
    },
    setSpeaking(speaking) {
      stopButton.hidden = !speaking;
      speakButton.hidden = speaking;
    },
    destroy() {
      host.remove();
    },
  };
}
