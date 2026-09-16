import { describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { handleHarness, type HarnessEvent, type HarnessS3Transport } from './handler';
import type { RenderCheck } from './browser';

const manifest = {
  schemaVersion: '1.0',
  artifactId: 'graph-stepper',
  artifactVersion: 1,
  title: 'Graph stepper',
  summary: 'Step through a graph search.',
  subjects: ['computer-science'],
  tags: ['graph'],
  interaction: 'stepper',
  provenance: { kind: 'catalog', sourceUrl: 'https://example.org/graph', license: 'MIT' },
  parameters: { type: 'object', properties: { beamWidth: { type: 'integer' } } },
  defaultParameters: { beamWidth: 8 },
  libraries: [],
  accessibility: { description: 'A graph with current and visited nodes.', keyboard: 'Space advances one step.' },
  render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
};

function body(value: string): { transformToString: () => Promise<string> } {
  return { transformToString: async () => value };
}

function fakeS3(): { s3: HarnessS3Transport; puts: { key?: string; body?: unknown }[] } {
  const puts: { key?: string; body?: unknown }[] = [];
  const objects = new Map<string, string>([
    ['artifacts/graph-stepper/1/manifest.json', JSON.stringify(manifest)],
    ['artifacts/graph-stepper/1/index.html', '<html><body>artifact</body></html>'],
    ['artifacts/graph-stepper/1/assets/data.json', '{"nodes":[]}'],
  ]);
  return {
    puts,
    s3: {
      async send(command: any) {
        const input = command.input as { Key?: string; Prefix?: string; Body?: unknown };
        if (command.constructor?.name === 'PutObjectCommand' || input.Body !== undefined) {
          puts.push({ key: input.Key, body: input.Body });
          return {};
        }
        if (input.Prefix !== undefined) {
          return { Contents: [...objects.keys()].filter(key => key.startsWith(input.Prefix!)).map(Key => ({ Key })) };
        }
        const value = objects.get(input.Key!);
        if (value === undefined) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        return { Body: body(value) };
      },
    },
  };
}

const event: HarnessEvent = {
  artifactId: 'graph-stepper',
  artifactVersion: 1,
  parameters: { beamWidth: 12 },
  jobId: 'job-harness',
};

describe('handleHarness', () => {
  it('downloads an artifact, calls the injected RenderCheck with its parameters, and uploads the screenshot key', async () => {
    const { s3, puts } = fakeS3();
    const render: RenderCheck = vi.fn(async ({ artifactDir, parameters }) => {
      expect(parameters).toEqual({ beamWidth: 12 });
      expect(await import('node:fs/promises').then(fs => fs.readFile(`${artifactDir}/manifest.json`, 'utf8'))).toContain('graph-stepper');
      expect(await import('node:fs/promises').then(fs => fs.readFile(`${artifactDir}/assets/data.json`, 'utf8'))).toContain('nodes');
      await writeFile(`${artifactDir}/screenshot.png`, Buffer.from('PNG'));
      return { ok: true, consoleErrors: [], unhandledRejections: [], screenshotPath: `${artifactDir}/screenshot.png` };
    });
    const result = await handleHarness(event, { s3, render, artifactsBucket: 'artifacts-bucket', tempRoot: '/tmp' });
    expect(result).toMatchObject({ ok: true, consoleErrors: [], unhandledRejections: [], screenshotKey: 'artifacts/graph-stepper/1/screenshots/job-harness.png' });
    expect(render).toHaveBeenCalledTimes(1);
    expect(puts.map(put => put.key)).toContain('artifacts/graph-stepper/1/screenshots/job-harness.png');
  });

  it('uses manifest defaults when no parameters are supplied', async () => {
    const { s3 } = fakeS3();
    const render: RenderCheck = vi.fn(async ({ artifactDir, parameters }) => {
      await writeFile(`${artifactDir}/screenshot.png`, Buffer.from('PNG'));
      return { ok: true, consoleErrors: [], unhandledRejections: [], screenshotPath: `${artifactDir}/screenshot.png`, ...{ parameters } } as any;
    });
    await handleHarness({ ...event, parameters: undefined }, { s3, render, artifactsBucket: 'artifacts-bucket', tempRoot: '/tmp' });
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ parameters: { beamWidth: 8 } }));
  });

  it('does not render or upload a screenshot when the stored manifest is invalid', async () => {
    const { s3, puts } = fakeS3();
    const invalidS3: HarnessS3Transport = {
      async send(command: any) {
        const input = command.input as { Key?: string; Prefix?: string };
        if (input.Key?.endsWith('/manifest.json')) return { Body: body(JSON.stringify({ ...manifest, libraries: ['not-blessed'] })) };
        return s3.send(command);
      },
    };
    const render = vi.fn(async () => ({ ok: true, consoleErrors: [], unhandledRejections: [], screenshotPath: '/tmp/no.png' }));
    await expect(handleHarness(event, { s3: invalidS3, render, artifactsBucket: 'artifacts-bucket', tempRoot: '/tmp' })).rejects.toThrow(/manifest|library/i);
    expect(render).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
  });
});
