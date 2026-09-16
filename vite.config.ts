import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react(), { name: 'extension-assets', closeBundle() { mkdirSync('dist', { recursive: true }); cpSync('apps/extension/manifest.json', 'dist/manifest.json'); cpSync('apps/extension/service-worker.js', 'dist/service-worker.js'); } }], build: { outDir: 'dist', emptyOutDir: true } });
