import { describe, expect, it } from 'vitest';
import {
  ExtensionToViewerSchema,
  HostToSandboxSchema,
  SandboxToHostSchema,
  ViewerToExtensionSchema,
  originAllowed,
  originFromUrl,
  parseAllowedOrigins,
} from './protocol';

const ctx = {
  slideTitle: 'HNSW search',
  slideDescription: 'A layered graph',
  lessonContext: 'Nearest-neighbor search',
  references: [{ docId: 'paper', title: 'HNSW paper', page: 3, quote: 'A graph' }],
};

describe('viewer protocol schemas', () => {
  it.each([
    {
      type: 'viz.load', packId: 'pack', packVersion: 1, assetId: 'slide-1',
      artifactId: 'hnsw-search-stepper', artifactVersion: 1, parameters: { ef: 32, M: 16 }, ctx,
    },
    { type: 'viz.highlight', regionId: 'layer-0' },
    { type: 'viz.freeze' },
    { type: 'viz.clear' },
  ])('accepts extension message $type', (message) => {
    expect(ExtensionToViewerSchema.safeParse(message).success).toBe(true);
  });

  it('rejects malformed extension messages', () => {
    expect(ExtensionToViewerSchema.safeParse({ type: 'viz.load', artifactId: 'x' }).success).toBe(false);
    expect(ExtensionToViewerSchema.safeParse({ type: 'viz.highlight', regionId: '' }).success).toBe(false);
    expect(ExtensionToViewerSchema.safeParse({ type: 'viz.freeze', extra: true }).success).toBe(false);
  });

  it('validates both viewer directions', () => {
    expect(ViewerToExtensionSchema.safeParse({ type: 'viz.ready' }).success).toBe(true);
    expect(ViewerToExtensionSchema.safeParse({ type: 'viz.loaded', artifactId: 'x', artifactVersion: 1 }).success).toBe(true);
    expect(ViewerToExtensionSchema.safeParse({ type: 'viz.error', code: 'params', message: 'bad' }).success).toBe(true);
    expect(ViewerToExtensionSchema.safeParse({ type: 'viz.error', code: 'unknown', message: 'bad' }).success).toBe(false);
  });

  it('validates the internal host-to-sandbox protocol in both directions', () => {
    expect(HostToSandboxSchema.safeParse({ type: 'sandbox.highlight', regionId: 'layer-0' }).success).toBe(true);
    expect(HostToSandboxSchema.safeParse({ type: 'sandbox.freeze' }).success).toBe(true);
    expect(SandboxToHostSchema.safeParse({ type: 'sandbox.ready' }).success).toBe(true);
    expect(SandboxToHostSchema.safeParse({ type: 'sandbox.loaded', artifactId: 'x', artifactVersion: 1 }).success).toBe(true);
  });

  it('matches only explicit origins and the chrome-extension wildcard', () => {
    expect(originFromUrl('chrome-extension://abc123/panel.html')).toBe('chrome-extension://abc123');
    expect(originAllowed('chrome-extension://abc123', parseAllowedOrigins('https://allowed.example.test', 'https://viewer.example.test'))).toBe(true);
    expect(originAllowed('https://evil.example.test', ['chrome-extension://*', 'https://allowed.example.test'])).toBe(false);
  });
});
