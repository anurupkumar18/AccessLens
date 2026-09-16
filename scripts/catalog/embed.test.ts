import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVectors, embeddingText } from './embed';
import { validateCatalog } from './validate';

const root = join(tmpdir(), 'accesslens-embed-fixture');

describe('catalog embeddings', () => {
  it('uses title, summary, tags, then subjects in embedding text', () => {
    const manifest = validateCatalog().artifacts[0];
    expect(embeddingText(manifest)).toBe([manifest.title, manifest.summary, ...manifest.tags, ...manifest.subjects].join(' '));
  });

  it('requires the harness gate unless skipHarness is explicit', async () => {
    await expect(buildVectors({ catalogRoot: 'packages/catalog', outputPath: join(root, 'vectors.json'), embed: async () => new Array(256).fill(0) })).rejects.toThrow(/harness report|skipHarness/i);
  });

  it('records an explicit skipped harness in vectors.json', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'accesslens-embed-'));
    try {
      const outputPath = join(directory, 'vectors.json');
      const output = await buildVectors({ catalogRoot: 'packages/catalog', outputPath, skipHarness: true, embed: async () => new Array(256).fill(0) });
      expect(output.skipHarness).toBe(true);
      expect(JSON.parse(readFileSync(outputPath, 'utf8')).skipHarness).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an incomplete harness report', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'accesslens-embed-'));
    try {
      const report = join(directory, 'report.json');
      writeFileSync(report, JSON.stringify({ reports: [{ artifactId: 'nearest-neighbor-graph-stepper', passed: true }] }));
      await expect(buildVectors({ catalogRoot: 'packages/catalog', outputPath: join(directory, 'vectors.json'), harnessReport: report, embed: async () => new Array(256).fill(0) })).rejects.toThrow(/complete passing report/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
