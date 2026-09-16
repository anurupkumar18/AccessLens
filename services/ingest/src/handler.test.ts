import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { handleIngest } from './handler';

const FIXTURE = join(process.cwd(), 'apps/viewer/fixtures/decks/mixed-subject.pdf');

class FakeS3 {
  readonly puts: Array<{ bucket?: string; key?: string; body?: unknown }> = [];
  constructor(private readonly source: Buffer) {}

  async send(command: unknown): Promise<unknown> {
    if (command instanceof GetObjectCommand) return { Body: this.source };
    if (command instanceof PutObjectCommand) {
      const input = command.input;
      this.puts.push({ bucket: input.Bucket, key: input.Key, body: input.Body });
      return {};
    }
    throw new Error('unexpected S3 command');
  }
}

describe('ingest Lambda staging boundary', () => {
  it('[slow] writes only job-scoped staging keys and keeps extracted text job-internal', async () => {
    const previousDecks = process.env.DECKS_BUCKET;
    const previousPacks = process.env.PACKS_BUCKET;
    process.env.DECKS_BUCKET = 'decks-test';
    process.env.PACKS_BUCKET = 'packs-test';
    try {
      const s3 = new FakeS3(readFileSync(FIXTURE));
      const deck = await handleIngest({
        jobId: 'job-stage-123',
        packId: 'mixed-subject',
        title: 'Mixed Subject Fixture',
        sourceKey: 'uploads/mixed-subject.pdf',
      }, { s3Client: s3, tempRoot: join(process.cwd(), '.tmp-ingest-test') });

      expect(deck.slides.length).toBeGreaterThanOrEqual(8);
      expect(deck.slides.every(slide => slide.extractedText.length >= 0)).toBe(true);
      expect(s3.puts.length).toBe(deck.slides.length + 1);
      expect(s3.puts.every(put => put.bucket === 'packs-test')).toBe(true);
      expect(s3.puts.every(put => put.key?.startsWith('staging/job-stage-123/'))).toBe(true);
      expect(s3.puts.map(put => put.key)).toContain('staging/job-stage-123/deck.json');
      expect(s3.puts.filter(put => put.key?.includes('/media/')).every(put => put.key?.endsWith('.png'))).toBe(true);
      expect(s3.puts.some(put => /^(packs|media|artifacts)\//.test(put.key ?? ''))).toBe(false);

      const stagedDeck = s3.puts.find(put => put.key?.endsWith('/deck.json'))?.body;
      expect(String(stagedDeck)).toContain('extractedText');
      expect(s3.puts.filter(put => put.key?.includes('/media/')).every(put => typeof put.body !== 'string')).toBe(true);
    } finally {
      if (previousDecks === undefined) delete process.env.DECKS_BUCKET;
      else process.env.DECKS_BUCKET = previousDecks;
      if (previousPacks === undefined) delete process.env.PACKS_BUCKET;
      else process.env.PACKS_BUCKET = previousPacks;
    }
  }, 120_000);
});
