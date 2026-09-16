import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCatalog, validateArtifactDirectory } from './validate';

const tempDirs: string[] = [];
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'accesslens-catalog-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'artifacts', 'fixture', '1'), { recursive: true });
  return root;
}
function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0', artifactId: 'fixture', artifactVersion: 1,
    title: 'Fixture', summary: 'A fixture visualization', subjects: ['testing'],
    tags: ['fixture'], interaction: 'diagram',
    provenance: { kind: 'catalog', sourceUrl: 'https://repository.example/catalog', license: 'CC0-1.0' },
    parameters: { type: 'object', properties: { amount: { type: 'number' } } },
    defaultParameters: { amount: 1 }, libraries: [],
    accessibility: { description: 'A fixture diagram.', keyboard: 'Use arrow keys.', semanticOutline: ['Diagram'] },
    render: { entry: 'index.html', minWidth: 480, minHeight: 320 }, ...overrides,
  };
}
function writeFixture(root: string, id: string, value: Record<string, unknown>, withHtml = true) {
  const dir = join(root, 'artifacts', id, '1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(value));
  if (withHtml) writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><script>window.accesslensInit=function(){};</script></body></html>');
}

afterEach(() => tempDirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('validateArtifactDirectory', () => {
  it('accepts a valid artifact and its HTML entry point', () => {
    const root = fixtureRoot();
    writeFixture(root, 'fixture', manifest());
    expect(validateArtifactDirectory(join(root, 'artifacts', 'fixture', '1')).artifactId).toBe('fixture');
  });

  it.each([
    ['an unblessed library', { libraries: ['not-blessed@1'] }],
    ['an empty accessibility keyboard instruction', { accessibility: { description: 'Picture', keyboard: '', semanticOutline: ['Picture'] } }],
    ['a default for an undeclared parameter', { defaultParameters: { amount: 1, missing: true } }],
  ])('rejects %s', (_label, override) => {
    const root = fixtureRoot();
    writeFixture(root, 'fixture', manifest(override));
    expect(() => validateArtifactDirectory(join(root, 'artifacts', 'fixture', '1'))).toThrow();
  });

  it('rejects a missing index.html', () => {
    const root = fixtureRoot();
    writeFixture(root, 'fixture', manifest(), false);
    expect(() => validateArtifactDirectory(join(root, 'artifacts', 'fixture', '1'))).toThrow(/index\.html/);
  });
});

describe('validateCatalog', () => {
  it('loops over all artifact directories and accepts the control fixtures', () => {
    const root = fixtureRoot();
    writeFixture(root, 'fixture', manifest());
    writeFixture(root, 'second', manifest({ artifactId: 'second' }));
    expect(validateCatalog(root).artifacts).toHaveLength(2);
  });

  it('rejects duplicate artifact ids', () => {
    const root = fixtureRoot();
    writeFixture(root, 'fixture', manifest());
    writeFixture(root, 'second', manifest());
    expect(() => validateCatalog(root)).toThrow(/duplicate artifact id/i);
  });
});
