import { beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactManifest } from '../../apps/extension/src/shared/contracts';
import { cosineSimilarity, retrieveCatalog, setEmbeddingProvider, setVectorLoader, type CatalogVector } from './index';

// A CatalogVector carries the whole manifest, so the fixture has to be a whole
// manifest. Stubbing it as {artifactId, title} type-checked nowhere until the
// V2 tsconfig started covering services/, and a partial stub would have hidden
// any future field the retriever starts reading.
const manifest = (artifactId: string): ArtifactManifest => ({
  schemaVersion: '1.0',
  artifactId,
  artifactVersion: 1,
  title: artifactId,
  summary: `A retrieval fixture standing in for the ${artifactId} artifact.`,
  subjects: ['computer-science'],
  tags: ['graph', 'search'],
  interaction: 'stepper',
  provenance: { kind: 'catalog', sourceUrl: `https://example.org/${artifactId}`, license: 'MIT' },
  parameters: { type: 'object', properties: { beamWidth: { type: 'integer', minimum: 1, maximum: 64 } } },
  defaultParameters: { beamWidth: 8 },
  libraries: ['d3@7'],
  accessibility: {
    description: 'A small undirected graph with the current node outlined.',
    keyboard: 'Space takes one step. Shift+Space steps back.',
    semanticOutline: ['Start node', 'Frontier', 'Visited set'],
  },
  render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
});
const vectors: CatalogVector[] = [
  { artifactId: 'same', artifactVersion: 1, vector: [1, 0], manifest: manifest('same') },
  { artifactId: 'orthogonal', artifactVersion: 1, vector: [0, 1], manifest: manifest('orthogonal') },
  { artifactId: 'diagonal', artifactVersion: 1, vector: [1, 1], manifest: manifest('diagonal') },
  { artifactId: 'tie-a', artifactVersion: 1, vector: [0, 1], manifest: manifest('tie-a') },
  { artifactId: 'tie-b', artifactVersion: 1, vector: [0, 1], manifest: manifest('tie-b') },
];

beforeEach(() => {
  setVectorLoader(async () => vectors);
  setEmbeddingProvider(async () => [1, 0]);
});

describe('cosineSimilarity', () => {
  it('scores identical vectors at one', () => expect(cosineSimilarity([1, 2], [1, 2])).toBe(1));
  it('scores orthogonal vectors at zero', () => expect(cosineSimilarity([1, 0], [0, 1])).toBe(0));
  it('matches the hand-computed diagonal score', () => expect(cosineSimilarity([1, 0], [1, 1])).toBeCloseTo(1 / Math.sqrt(2)));
  it('returns zero for a zero vector', () => expect(cosineSimilarity([0, 0], [1, 0])).toBe(0));
});

describe('retrieveCatalog', () => {
  it('returns top-k in descending score with stable artifact-id tie ordering', async () => {
    const results = await retrieveCatalog('graph search', 5);
    expect(results.map(result => result.artifactId)).toEqual(['same', 'diagonal', 'orthogonal', 'tie-a', 'tie-b']);
    expect(results[0]).toMatchObject({ artifactId: 'same', artifactVersion: 1, score: 1, manifest: manifest('same') });
  });

  it('returns an empty array when the catalog has no vectors', async () => {
    setVectorLoader(async () => []);
    expect(await retrieveCatalog('nothing')).toEqual([]);
  });

  it('returns no matches for an empty concept so the Generator can take over', async () => {
    expect(await retrieveCatalog('', 2)).toEqual([]);
  });
});
