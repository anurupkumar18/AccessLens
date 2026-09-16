/**
 * Content-script entry: puts the orb on whatever page the student is reading.
 *
 * Injected into arbitrary sites, so it guards against running twice, keeps all
 * of its DOM inside a closed shadow root, and fails quietly rather than
 * throwing into someone else's page.
 */

import { requestExplanation, ExplainUnavailable, type ExplainMode } from './explain';
import { mountOrb, type OrbView } from './orbUi';
import { readPageContext } from './pageContext';
import { readCanvasContext, isCanvasPage } from './canvasContext';
import { speakableText, type Attributed } from './provenance';
import { createSpeaker } from './speech';

const ALREADY_MOUNTED = 'data-accesslens-orb-mounted';

/**
 * Narrowly declared rather than pulled from `@types/chrome`, matching the
 * convention already used in `shared/preferences.ts`: only the surface this
 * file touches, so the content script stays runnable in a plain page during
 * tests where no extension APIs exist.
 */
interface ExtensionApis {
  storage?: { local?: { get(key: string): Promise<Record<string, unknown>> } };
  runtime?: { onMessage?: { addListener(fn: (message: { type?: string }) => void): void } };
}
declare const chrome: ExtensionApis | undefined;

const PROMPTS: Record<ExplainMode, string> = {
  explain: 'Explaining this page…',
  simplify: 'Putting this in simpler words…',
  diagram: 'Drawing a diagram…',
};

/**
 * Build-time default, overridable at run time.
 *
 * The deployed endpoint changes every time the temporary account is rebuilt, so
 * baking one in alone would strand anyone holding an older build. Storage wins
 * when set, which also lets someone point at their own instance.
 */
const BUILT_IN_ENDPOINT: string = import.meta.env?.VITE_ACCESSLENS_ORB_ENDPOINT ?? '';

async function readEndpoint(): Promise<string> {
  try {
    const store = typeof chrome !== 'undefined' ? chrome?.storage?.local : undefined;
    if (store) {
      const stored = await store.get('orbEndpoint');
      if (typeof stored.orbEndpoint === 'string' && stored.orbEndpoint) return stored.orbEndpoint;
    }
  } catch {
    // Fall through to the built-in default.
  }
  return BUILT_IN_ENDPOINT;
}

function start(): void {
  if (document.documentElement.hasAttribute(ALREADY_MOUNTED)) return;
  document.documentElement.setAttribute(ALREADY_MOUNTED, '');

  const speaker = createSpeaker();
  let lastSpoken = '';
  let inFlight: AbortController | undefined;
  let view: OrbView;

  const run = async (mode: ExplainMode) => {
    inFlight?.abort();
    inFlight = new AbortController();
    view.setBusy(true, PROMPTS[mode]);
    try {
      const context = isCanvasPage() ? readCanvasContext('') : readPageContext();
      if (!context.text) {
        view.showError('There is no readable text on this page to explain.');
        return;
      }
      const endpoint = await readEndpoint();
      const answer: Attributed<{ text: string; svg?: string }> = await requestExplanation(
        endpoint,
        { mode, title: context.title, url: context.url, text: context.text },
        inFlight.signal,
      );
      lastSpoken = speakableText({ ...answer, value: answer.value.text });
      view.showResult(answer.notice, answer.value.text, answer.value.svg);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      view.showError(
        error instanceof ExplainUnavailable
          ? error.message
          : 'Could not reach the explanation service.',
      );
    } finally {
      view.setBusy(false);
    }
  };

  view = mountOrb(
    {
      onAction: mode => void run(mode),
      onSpeak: () => {
        const context = isCanvasPage() ? readCanvasContext('') : readPageContext();
        // Prefer the generated explanation if there is one; otherwise read the
        // page itself, which is quoted rather than generated and so needs no
        // AI-generated warning.
        speaker.speak(lastSpoken || context.text.slice(0, 4000));
        view.setSpeaking(true);
      },
      onStopSpeaking: () => {
        speaker.stop();
        view.setSpeaking(false);
      },
      onClose: () => {
        speaker.stop();
        view.setSpeaking(false);
        view.close();
      },
    },
    speaker.available,
  );

  // Toolbar click opens the orb, so it is reachable without hunting for it.
  if (typeof chrome !== 'undefined') {
    chrome?.runtime?.onMessage?.addListener(message => {
      if (message?.type === 'accesslens:toggle-orb') {
        if (view.isOpen) view.close();
        else view.open();
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
