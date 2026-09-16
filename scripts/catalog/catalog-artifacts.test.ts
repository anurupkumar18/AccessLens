import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { validateCatalog } from './validate';

describe('checked-in catalog artifact HTML', () => {
  it('parses every seed and defines accesslensInit', () => {
    const catalog = validateCatalog();
    // The count is not the bar. D6 records what happened when a lane treated it
    // as one: one template stamped 150 times, every copy passing the harness.
    // What this test protects is that every artifact that *is* checked in is a
    // parseable page exposing the viewer's init contract.
    expect(catalog.artifacts.length).toBeGreaterThan(0);
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
