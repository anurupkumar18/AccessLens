import { describe, expect, it } from 'vitest';
import { retrieveCatalog } from '../../services/retriever';

describe('catalog Bedrock acceptance', () => {
  it('returns nearest-neighbor graph search in the top three when opted into live AWS', async () => {
    if (process.env.RUN_BEDROCK_ACCEPTANCE !== '1') return;
    const results = await retrieveCatalog('nearest neighbor graph search', 3);
    expect(results.map(result => result.artifactId)).toContain('nearest-neighbor-graph-stepper');
  }, 60_000);
});
