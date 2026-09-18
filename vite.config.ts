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
  // Agent worktrees (.claude/, .worktrees/), built output and CDK staging all
  // hold copies of this repo's tests; without these excludes `vitest run`
  // reports a count that has nothing to do with this tree.
  // Local hosting: the browser tab on localhost has no extension host
  // permissions, and neither CloudFront nor the AI gateway answer CORS for it,
  // so the dev server proxies the published pack, its media and the AI routes.
  server: { proxy: {
    // Only the published shape packs/<packId>/<version>.json; the bundled
    // packs/<id>/pack.draft.json and slides are Vite modules, not proxied.
    '^/packs/[^/]+/[0-9]+\\.json$': { target: 'https://d7dxgg82mglf.cloudfront.net', changeOrigin: true },
    '/media': { target: 'https://d7dxgg82mglf.cloudfront.net', changeOrigin: true },
    '/ai': { target: 'https://nxhrvn0odk.execute-api.us-east-1.amazonaws.com', changeOrigin: true, rewrite: (path) => path.replace(/^\/ai/, '') },
  } },
  test: { exclude: [...configDefaults.exclude, '.claude/**', '**/dist/**', '**/dist-web/**', '**/.worktrees/**', '**/cdk.out/**'] } });
