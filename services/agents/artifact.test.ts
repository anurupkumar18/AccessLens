import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertAdaptedProvenance,
  assertGeneratedProvenance,
  manifestParametersAgree,
  writeArtifactDirectory,
  type ArtifactDirectory,
} from './artifact';
import type { ArtifactManifest } from '../../apps/extension/src/shared/contracts';

const manifest: ArtifactManifest = {
  schemaVersion: '1.0',
  artifactId: 'parent-stepper',
  artifactVersion: 2,
  title: 'Parent stepper',
  summary: 'Step through a process.',
  subjects: ['computer-science'],
  tags: ['stepper'],
  interaction: 'stepper',
  provenance: { kind: 'catalog', sourceUrl: 'https://example.org/parent', license: 'MIT' },
  parameters: { type: 'object', properties: { speed: { type: 'integer' } } },
  defaultParameters: { speed: 2 },
  libraries: [],
  accessibility: { description: 'A process with a highlighted current step.', keyboard: 'Space advances to the next step.' },
  render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
};

const artifact: ArtifactDirectory = {
  manifest,
  indexHtml: '<html><script>window.accesslensInit=function(){};</script></html>',
  assets: { 'data/config.json': '{"speed":2}' },
  references: [],
};

describe('artifact boundary helpers', () => {
  it('writes a complete artifact directory with manifest, entry, and assets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'accesslens-artifact-'));
    await writeArtifactDirectory(artifact, directory);
    expect(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))).toEqual(manifest);
    expect(await readFile(join(directory, 'index.html'), 'utf8')).toContain('accesslensInit');
    expect(await readFile(join(directory, 'assets/data/config.json'), 'utf8')).toBe('{"speed":2}');
  });

  it('rejects an asset path that could escape the artifact directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'accesslens-artifact-'));
    await expect(writeArtifactDirectory({ ...artifact, assets: { '../outside.txt': 'nope' } }, directory)).rejects.toThrow(/asset path/);
  });

  it('checks adapted ancestry, unchanged license, job, and parameter/default agreement', () => {
    const adapted = {
      ...manifest,
      artifactId: 'adapted-stepper',
      provenance: {
        kind: 'adapted' as const,
        parentArtifactId: manifest.artifactId,
        parentArtifactVersion: manifest.artifactVersion,
        license: 'MIT',
        generatedBy: 'us.anthropic.claude-sonnet-4-6',
        jobId: 'job-1',
      },
    };
    expect(manifestParametersAgree(adapted)).toBe(true);
    expect(() => assertAdaptedProvenance(adapted, manifest, 'job-1')).not.toThrow();
    expect(() => assertAdaptedProvenance({ ...adapted, defaultParameters: {} }, manifest, 'job-1')).toThrow(/parameters/);
  });

  it('checks generated job provenance', () => {
    const generated = { ...manifest, provenance: { kind: 'generated' as const, generatedBy: 'us.anthropic.claude-sonnet-4-6', jobId: 'job-2' } };
    expect(() => assertGeneratedProvenance(generated, 'job-2')).not.toThrow();
    expect(() => assertGeneratedProvenance(generated, 'other-job')).toThrow(/jobId/);
  });
});
