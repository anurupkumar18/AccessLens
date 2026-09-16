// Google Slides as a slide source. When a deck is presenting in this Chrome
// profile, the tab's URL names the current slide and changes on every
// advance; watching tab URLs is the whole signal. Nothing runs inside
// Google's page and no pixels are read. The instructor starts the session
// first and presents whenever they like: the watcher notices the presenting
// tab when it appears.

/** The deck and slide a presenting tab is on. `slideObjectId` is null on the deck's opening slide when the URL omits it. */
export interface PresentingSlide { deckId: string; slideObjectId: string | null }

/** Notifies with the presenting slide, or null when no Slides tab is presenting. */
export interface SlidesWatcher {
  watch(listener: (slide: PresentingSlide | null) => void): () => void;
}

/** The deck's slide object ids in order; position maps to the pack's slide order. */
export type SlideOrder = (deckId: string) => Promise<string[]>;

export interface SlidesSource { watcher: SlidesWatcher; slideOrder: SlideOrder }

const PRESENT_PATH = /^\/presentation\/d\/([^/]+)\/present(?:ation)?\b/u;

/** Parses a tab URL; anything that is not a Google Slides deck in present mode is null. */
export function parsePresentingSlide(url: string | undefined): PresentingSlide | null {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.hostname !== 'docs.google.com') return null;
  const match = PRESENT_PATH.exec(parsed.pathname);
  if (!match) return null;
  const slideParam = parsed.searchParams.get('slide') ?? new URLSearchParams(parsed.hash.replace(/^#/u, '')).get('slide');
  const slideObjectId = slideParam?.startsWith('id.') ? slideParam.slice(3) : null;
  return { deckId: match[1], slideObjectId };
}

interface TabsApi {
  query(info: { url?: string[] }): Promise<Array<{ id?: number; url?: string }>>;
  onUpdated: { addListener(l: (tabId: number, change: { url?: string }, tab: { url?: string }) => void): void; removeListener(l: (tabId: number, change: { url?: string }, tab: { url?: string }) => void): void };
  onRemoved: { addListener(l: (tabId: number) => void): void; removeListener(l: (tabId: number) => void): void };
}

/** Present when running as the installed extension with the `tabs` permission. */
export function chromeTabs(): TabsApi | null {
  const api = (globalThis as { chrome?: { tabs?: Partial<TabsApi> } }).chrome?.tabs;
  return api?.onUpdated && api.onRemoved && api.query ? (api as TabsApi) : null;
}

/**
 * Follows the first tab found presenting a deck and stays on it until that
 * tab leaves present mode or closes; then the next presenting tab is taken.
 */
export function createChromeSlidesWatcher(tabs: TabsApi): SlidesWatcher {
  return {
    watch(listener) {
      let followed: number | null = null;
      let last: string | null = null;
      function report(slide: PresentingSlide | null): void {
        const key = slide ? `${slide.deckId}/${slide.slideObjectId ?? ''}` : null;
        if (key === last) return;
        last = key;
        listener(slide);
      }
      function onUpdated(tabId: number, change: { url?: string }, tab: { url?: string }): void {
        const url = change.url ?? tab.url;
        if (url === undefined) return;
        const slide = parsePresentingSlide(url);
        if (followed === null && slide) followed = tabId;
        if (tabId !== followed) return;
        if (!slide) { followed = null; report(null); return; }
        report(slide);
      }
      function onRemoved(tabId: number): void {
        if (tabId !== followed) return;
        followed = null;
        report(null);
      }
      tabs.onUpdated.addListener(onUpdated);
      tabs.onRemoved.addListener(onRemoved);
      void tabs.query({ url: ['https://docs.google.com/presentation/d/*/present*'] }).then((open) => {
        const first = open.find((tab) => tab.id !== undefined && parsePresentingSlide(tab.url));
        if (first && followed === null) onUpdated(first.id!, {}, first);
      }).catch(() => undefined);
      return () => { tabs.onUpdated.removeListener(onUpdated); tabs.onRemoved.removeListener(onRemoved); };
    },
  };
}

export const SLIDES_READONLY_SCOPE = 'https://www.googleapis.com/auth/presentations.readonly';

/** Reads a deck's slide order through the Slides API with a bearer token the caller obtains. Cached per deck. */
export function createSlidesOrderClient(getAccessToken: () => Promise<string>, fetchImpl: typeof fetch = (...args) => fetch(...args)): SlideOrder {
  const cache = new Map<string, Promise<string[]>>();
  return (deckId) => {
    let pending = cache.get(deckId);
    if (!pending) {
      pending = (async () => {
        const token = await getAccessToken();
        const response = await fetchImpl(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(deckId)}?fields=slides.objectId`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`Google Slides answered ${response.status} for this deck.`);
        const body = await response.json() as { slides?: Array<{ objectId: string }> };
        return (body.slides ?? []).map((slide) => slide.objectId);
      })();
      pending.catch(() => cache.delete(deckId));
      cache.set(deckId, pending);
    }
    return pending;
  };
}
