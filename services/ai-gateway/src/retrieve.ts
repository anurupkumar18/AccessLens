import type { ReviewedPack } from './packs.js';

/** One retrievable passage: a reviewed region with its slide for context. */
export interface Passage {
  id: string;
  assetId: string;
  assetTitle: string;
  regionId: string;
  label: string;
  text: string;
}

export interface Hit { passage: Passage; score: number }

const STOPWORDS = new Set(('a an and are as at be by can do does for from has have how i in into is it its me my of on or our so that the their them then there these they this to was we what when where which who why will with you your about does did '
  + 'explain tell please mean means called').split(' '));

/**
 * Lowercase words, stopwords dropped, cut to a five-letter stem so
 * "mitochondria" finds "mitochondrion" and "nuclei" finds "nucleus". Crude,
 * deterministic, and plenty for a pack of a few dozen reviewed regions; the
 * model never sees a passage retrieval did not pick.
 */
export function terms(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1 && !STOPWORDS.has(word)).map(word => word.slice(0, 5));
}

export function passagesFor(pack: ReviewedPack): Passage[] {
  return pack.assets.flatMap(asset => asset.regions.map(region => ({
    id: `${asset.assetId}#${region.regionId}`,
    assetId: asset.assetId,
    assetTitle: asset.title,
    regionId: region.regionId,
    label: region.label ?? region.regionId,
    text: `${region.label ?? region.regionId}. ${region.shortDescription} ${region.plainLanguage}`,
  })));
}

/** BM25 over the pack's passages. Returns only passages sharing a term with the question, best first. */
export function retrieve(pack: ReviewedPack, question: string, limit = 4): Hit[] {
  const passages = passagesFor(pack);
  const docs = passages.map(passage => terms(`${passage.assetTitle} ${passage.text}`));
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length);
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) for (const term of new Set(doc)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);

  const query = [...new Set(terms(question))];
  const k1 = 1.2;
  const b = 0.75;
  return passages
    .map((passage, index) => {
      const doc = docs[index]!;
      let score = 0;
      for (const term of query) {
        const frequency = doc.filter(word => word === term).length;
        if (frequency === 0) continue;
        const df = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
        score += idf * ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + (b * doc.length) / averageLength)));
      }
      return { passage, score };
    })
    .filter(hit => hit.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
