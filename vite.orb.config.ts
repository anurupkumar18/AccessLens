import { defineConfig } from 'vite';

/**
 * Separate build for the orb content script.
 *
 * MV3 content scripts are not ES modules, so this emits a single self-contained
 * IIFE at a stable filename the manifest can reference. The side panel keeps
 * its own hashed-asset build in `vite.config.ts`; mixing the two in one config
 * would force both into the same output format.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'apps/extension/src/orb/index.ts',
      formats: ['iife'],
      name: 'AccessLensOrb',
      fileName: () => 'orb.js',
    },
    rollupOptions: { output: { extend: true } },
  },
});
