import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCatalogHarness, type ViewerHarnessRunner } from './harness';

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'accesslens-harness-'));
  mkdirSync(join(root, 'artifacts', 'fixture', '1'), { recursive: true });
  writeFileSync(join(root, 'artifacts', 'fixture', '1', 'manifest.json'), JSON.stringify({
    schemaVersion: '1.0', artifactId: 'fixture', artifactVersion: 1,
    title: 'Fixture', summary: 'A fixture interactive for testing', subjects: ['testing'], tags: ['fixture'], interaction: 'diagram',
    provenance: { kind: 'catalog', sourceUrl: 'https://example.com/fixture', license: 'CC0-1.0' },
    parameters: { type: 'object', properties: { step: { type: 'integer' } } }, defaultParameters: { step: 0 }, libraries: [],
    accessibility: { description: 'A diagram with a selectable test node and a changing status.', keyboard: 'Use arrow keys to advance the node.', semanticOutline: ['Node'] },
    render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
  }));
  writeFileSync(join(root, 'artifacts', 'fixture', '1', 'index.html'), '<!doctype html><html><body><p id="status" aria-live="polite" tabindex="0"></p><script>window.accesslensInit=function(){document.getElementById("status").textContent="ready"};document.addEventListener("keydown",function(){});</script></body></html>');
  return root;
}

const passRunner: ViewerHarnessRunner = {
  async runArtifact() {
    return { passed: true, consoleErrors: [], unhandledRejections: [] };
  },
};

const failRunner: ViewerHarnessRunner = {
  async runArtifact() {
    return { passed: false, consoleErrors: ['render failed'], unhandledRejections: [] };
  },
};

describe('catalog viewer harness orchestration', () => {
  it('runs the supplied viewer runner and writes a complete JSON report', async () => {
    const root = fixtureRoot();
    try {
      const reportPath = join(root, 'harness-report.json');
      const reports = await runCatalogHarness(root, passRunner, reportPath);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ artifactId: 'fixture', artifactVersion: 1, passed: true });
      expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({ reports });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps static manifest and HTML property failures in the report and fails the artifact', async () => {
    const root = fixtureRoot();
    try {
      writeFileSync(join(root, 'artifacts', 'fixture', '1', 'index.html'), '<!doctype html><html><body><script>window.accesslensInit=function(){};</script></body></html>');
      const reports = await runCatalogHarness(root, failRunner);
      expect(reports[0].passed).toBe(false);
      expect(reports[0].violations?.some(violation => violation.rule === 'artifact.live-region')).toBe(true);
      expect(reports[0].consoleErrors).toContain('render failed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
