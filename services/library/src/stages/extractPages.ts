/**
 * Temporary extraction adapter for the ingest lane.
 *
 * The ingest service owns the production LibreOffice/poppler container. Until
 * its reusable `extractPages` export lands, this adapter calls the installed
 * `pdftotext` binary directly and keeps the stage contract identical.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PageText } from './types';

const execFileAsync = promisify(execFile);

export async function extractPages(path: string): Promise<PageText[]> {
  const pageCount = await pageCountFromPdf(path);
  const pages: PageText[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-f', String(page), '-l', String(page), path, '-'], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    });
    pages.push({ page, text: stdout });
  }
  return pages;
}

async function pageCountFromPdf(path: string): Promise<number> {
  const { stdout } = await execFileAsync('pdfinfo', [path], { maxBuffer: 1024 * 1024, timeout: 30_000 });
  const match = /^Pages:\s+(\d+)$/mu.exec(stdout);
  if (!match) throw new Error(`pdfinfo did not report a page count for ${path}`);
  const pageCount = Number(match[1]);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('PDF has no pages');
  return pageCount;
}
