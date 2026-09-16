import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadCatalog } from './upload';

describe('uploadCatalog', () => {
  it('syncs all catalog files with relative keys and content types', async () => {
    const root = mkdtempSync(join(tmpdir(), 'accesslens-upload-'));
    try {
      mkdirSync(join(root, 'artifacts', 'demo', '1'), { recursive: true });
      writeFileSync(join(root, 'vectors.json'), '{}');
      writeFileSync(join(root, 'artifacts', 'demo', '1', 'index.html'), '<html></html>');
      const commands: unknown[] = [];
      const count = await uploadCatalog({ bucket: 'catalog-test', catalogRoot: root, send: async command => { commands.push(command); } });
      expect(count).toBe(2);
      expect(commands).toHaveLength(2);
      expect(JSON.stringify(commands)).toContain('catalog-test');
      expect(JSON.stringify(commands)).toContain('artifacts/demo/1/index.html');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires a non-empty bucket', async () => {
    await expect(uploadCatalog({ bucket: ' ', catalogRoot: tmpdir(), send: async () => undefined })).rejects.toThrow(/bucket is required/);
  });
});
