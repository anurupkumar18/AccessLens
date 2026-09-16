import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { validateCatalog } from './validate';

describe('checked-in catalog artifact HTML', () => {
  it('parses every seed and defines accesslensInit', () => {
    const catalog = validateCatalog();
    expect(catalog.artifacts.length).toBeGreaterThanOrEqual(150);
    for (const directory of catalog.directories) {
      const html = readFileSync(`${directory}/index.html`, 'utf8');
      const dom = new JSDOM(html, { runScripts: 'outside-only' });
      expect(dom.window.document.documentElement).toBeTruthy();
      expect(html).toMatch(/window\s*\.\s*accesslensInit\s*=/);
      dom.window.close();
    }
    expect(new Set(catalog.artifacts.flatMap(artifact => artifact.subjects)).size).toBeGreaterThanOrEqual(12);
    expect(catalog.artifacts.every(artifact => artifact.provenance.kind === 'catalog' && artifact.provenance.license === 'CC0-1.0')).toBe(true);
  });
});
