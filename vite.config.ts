import { defineConfig } from 'vitest/config';
import { configDefaults } from 'vitest/config';
import { cpSync, mkdirSync } from 'node:fs';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react(), { name: 'extension-assets', closeBundle() { mkdirSync('dist', { recursive: true }); cpSync('apps/extension/manifest.json', 'dist/manifest.json'); cpSync('apps/extension/service-worker.js', 'dist/service-worker.js'); } }], build: { outDir: 'dist', emptyOutDir: true },
  // .claude/ holds gitignored agent worktrees: stale copies of this repo's tests.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] } });
