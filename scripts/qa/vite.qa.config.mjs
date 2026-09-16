// QA-only Vite config. Same app and plugins as the root vite.config.ts, but the
// extension files (manifest.json, service-worker.js) are copied into whatever
// --outDir the build uses, instead of the hard-coded `dist/`. That keeps QA
// builds out of the committed dist/ directory.
//
// Used by scripts/qa/common.cjs; not meant to be run by hand, but it works:
//   VITE_ACCESSLENS_WS_URL=wss://... npx vite build --config scripts/qa/vite.qa.config.mjs --outDir .cache/qa/build
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(() => {
  let outDir = resolve(repoRoot, '.cache/qa/build');
  return {
    root: repoRoot,
    plugins: [
      react(),
      {
        name: 'qa-extension-assets',
        configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
        closeBundle() {
          mkdirSync(outDir, { recursive: true });
          cpSync(resolve(repoRoot, 'apps/extension/manifest.json'), resolve(outDir, 'manifest.json'));
          cpSync(resolve(repoRoot, 'apps/extension/service-worker.js'), resolve(outDir, 'service-worker.js'));
        },
      },
    ],
    build: { outDir, emptyOutDir: true },
  };
});
