import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react(), { name: 'extension-assets', closeBundle() { mkdirSync('dist', { recursive: true }); cpSync('apps/extension/manifest.json', 'dist/manifest.json'); cpSync('apps/extension/service-worker.js', 'dist/service-worker.js'); } }], build: { outDir: 'dist', emptyOutDir: true },
  // Part 6 runs parallel implementation lanes in git worktrees under
  // .worktrees/, each a full checkout. Without this, `vitest run` at the
  // repository root collects every lane's copy of every test and reports a
  // test count that has nothing to do with this tree.
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'] } });
