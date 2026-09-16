import { describe, expect, it, vi } from 'vitest';
import { createChromeSlidesWatcher, createSlidesOrderClient, parsePresentingSlide } from './index';

describe('parsePresentingSlide', () => {
  it('reads the deck and slide from a presenting tab, in the query or the fragment, and nothing else', () => {
    expect(parsePresentingSlide('https://docs.google.com/presentation/d/1AbC_x/present?slide=id.g2f_0_12')).toEqual({ deckId: '1AbC_x', slideObjectId: 'g2f_0_12' });
    expect(parsePresentingSlide('https://docs.google.com/presentation/d/1AbC_x/present#slide=id.p')).toEqual({ deckId: '1AbC_x', slideObjectId: 'p' });
    expect(parsePresentingSlide('https://docs.google.com/presentation/d/1AbC_x/present')).toEqual({ deckId: '1AbC_x', slideObjectId: null });
    expect(parsePresentingSlide('https://docs.google.com/presentation/d/1AbC_x/edit#slide=id.p')).toBeNull();
    expect(parsePresentingSlide('https://example.com/presentation/d/1AbC_x/present')).toBeNull();
    expect(parsePresentingSlide(undefined)).toBeNull();
    expect(parsePresentingSlide('not a url')).toBeNull();
  });
});

function fakeTabs(open: Array<{ id: number; url: string }> = []) {
  const updated = new Set<(tabId: number, change: { url?: string }, tab: { url?: string }) => void>();
  const removed = new Set<(tabId: number) => void>();
  return {
    api: {
      query: async () => open,
      onUpdated: { addListener: (l: (tabId: number, change: { url?: string }, tab: { url?: string }) => void) => { updated.add(l); }, removeListener: (l: (tabId: number, change: { url?: string }, tab: { url?: string }) => void) => { updated.delete(l); } },
      onRemoved: { addListener: (l: (tabId: number) => void) => { removed.add(l); }, removeListener: (l: (tabId: number) => void) => { removed.delete(l); } },
    },
    navigate(tabId: number, url: string) { for (const l of updated) l(tabId, { url }, { url }); },
    close(tabId: number) { for (const l of removed) l(tabId); },
    listeners: () => updated.size + removed.size,
  };
}

describe('createChromeSlidesWatcher', () => {
  it('follows the first presenting tab through slide changes, releases it when it leaves present mode, and dedupes', () => {
    const tabs = fakeTabs();
    const seen: unknown[] = [];
    const stop = createChromeSlidesWatcher(tabs.api).watch((slide) => seen.push(slide));
    tabs.navigate(1, 'https://docs.google.com/presentation/d/deck/edit');
    tabs.navigate(2, 'https://mail.google.com/');
    expect(seen).toEqual([]);
    tabs.navigate(1, 'https://docs.google.com/presentation/d/deck/present?slide=id.p');
    tabs.navigate(1, 'https://docs.google.com/presentation/d/deck/present?slide=id.p');
    tabs.navigate(1, 'https://docs.google.com/presentation/d/deck/present?slide=id.g1_0_3');
    // A second presenting tab is ignored while the first is followed.
    tabs.navigate(3, 'https://docs.google.com/presentation/d/other/present?slide=id.p');
    tabs.navigate(1, 'https://docs.google.com/presentation/d/deck/edit#slide=id.g1_0_3');
    expect(seen).toEqual([
      { deckId: 'deck', slideObjectId: 'p' },
      { deckId: 'deck', slideObjectId: 'g1_0_3' },
      null,
    ]);
    // Now the other tab can be picked up, and closing it reports null once.
    tabs.navigate(3, 'https://docs.google.com/presentation/d/other/present?slide=id.g9');
    tabs.close(3);
    tabs.close(3);
    expect(seen.slice(3)).toEqual([{ deckId: 'other', slideObjectId: 'g9' }, null]);
    stop();
    expect(tabs.listeners()).toBe(0);
  });

  it('picks up a tab that was already presenting when the watch began', async () => {
    const tabs = fakeTabs([{ id: 7, url: 'https://docs.google.com/presentation/d/deck/present?slide=id.g5' }]);
    const seen: unknown[] = [];
    createChromeSlidesWatcher(tabs.api).watch((slide) => seen.push(slide));
    await Promise.resolve(); await Promise.resolve();
    expect(seen).toEqual([{ deckId: 'deck', slideObjectId: 'g5' }]);
  });
});

describe('createSlidesOrderClient', () => {
  it('asks the Slides API once per deck with the bearer token and returns object ids in order', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ slides: [{ objectId: 'p' }, { objectId: 'g1' }] }), { status: 200 }));
    const order = createSlidesOrderClient(async () => 'tok', fetchImpl as unknown as typeof fetch);
    expect(await order('deck')).toEqual(['p', 'g1']);
    expect(await order('deck')).toEqual(['p', 'g1']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual(['https://slides.googleapis.com/v1/presentations/deck?fields=slides.objectId', { headers: { authorization: 'Bearer tok' } }]);
  });

  it('surfaces a failed call and retries on the next request', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(new Response(JSON.stringify({ slides: [{ objectId: 'p' }] }), { status: 200 }));
    const order = createSlidesOrderClient(async () => 'tok', fetchImpl as unknown as typeof fetch);
    await expect(order('deck')).rejects.toThrow('403');
    expect(await order('deck')).toEqual(['p']);
  });
});
