/**
 * Voice-driven sync: when the instructor names a part of the current slide
 * ("now look at the nucleus"), find that reviewed region. Only regions of the
 * slide already matched on screen are candidates, so speech can move students
 * within reviewed content but can never introduce a slide or invent a region
 * (charter A9).
 *
 * Words match on a shared stem of at least five letters, so "nuclei" finds
 * "nucleus" and "mitochondria" finds "mitochondrion"; when two names both
 * match ("nuclei" against Nucleus and Nucleolus) the closer spelling wins. A
 * name of three or more words also matches without its first word, because
 * people say "endoplasmic reticulum" for "Rough endoplasmic reticulum".
 */

interface RegionLike { regionId: string; label?: string }

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3);

function sharedPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Closeness of a spoken word to a name word, or 0 when they are different words. */
function closeness(said: string, name: string): number {
  if (said === name) return 100;
  const shared = sharedPrefix(said, name);
  return shared >= Math.min(5, said.length, name.length) ? shared : 0;
}

/** The last-mentioned region of `regions` in `utterance`, or null when none is named. */
export function spokenRegion(utterance: string, regions: readonly RegionLike[]): string | null {
  const spoken = words(utterance);
  let best: { regionId: string; position: number; score: number } | null = null;
  for (const region of regions) {
    const full = words(region.label ?? region.regionId.replace(/[-_]/g, ' '));
    const forms = full.length >= 3 ? [full, full.slice(1)] : [full];
    for (const name of forms) {
      if (name.length === 0) continue;
      for (let i = 0; i + name.length <= spoken.length; i++) {
        const scores = name.map((part, k) => closeness(spoken[i + k]!, part));
        if (scores.some(score => score === 0)) continue;
        const score = scores.reduce((sum, s) => sum + s, 0);
        const end = i + name.length;
        if (!best || end > best.position || (end === best.position && score > best.score)) best = { regionId: region.regionId, position: end, score };
      }
    }
  }
  return best?.regionId ?? null;
}
