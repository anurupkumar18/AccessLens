import { defineConfig } from 'vitest/config';
import { configDefaults } from 'vitest/config';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
let outDir = 'dist';
export default defineConfig({ plugins: [react(), { name: 'extension-assets', configResolved(config) { outDir = config.build.outDir; }, closeBundle() { mkdirSync(outDir, { recursive: true }); cpSync('apps/extension/manifest.json', join(outDir, 'manifest.json')); cpSync('apps/extension/service-worker.js', join(outDir, 'service-worker.js')); } }],
  // Worklets load through addModule, which the extension CSP (script-src 'self')
  // refuses as a data: URL, so they must ship as files, never inlined.
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: (file) => (file.endsWith('.worklet.js') ? false : undefined) },
  // .claude/ holds gitignored agent worktrees: stale copies of this repo's tests.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] } });
