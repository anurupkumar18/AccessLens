/**
 * The native tools in the worker image: LibreOffice, poppler, ffmpeg,
 * ImageMagick, libheif, librsvg. Only the worker imports this file.
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MB = 1024 * 1024;

async function exec(command: string, args: string[], timeoutMs: number): Promise<string> {
  const { stdout } = await run(command, args, { timeout: timeoutMs, maxBuffer: 64 * MB, env: { ...process.env, HOME: '/tmp' } });
  return stdout;
}

/** Office formats -> PDF. LibreOffice needs a writable profile, hence HOME=/tmp. */
export async function officeToPdf(input: string, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  await exec('soffice', ['--headless', '--norestore', '--nolockcheck', '--convert-to', 'pdf', '--outdir', outDir, input], 6 * 60_000);
  return join(outDir, `${basename(input, extname(input))}.pdf`);
}

export async function pdfPageCount(pdf: string): Promise<number> {
  const info = await exec('pdfinfo', [pdf], 60_000);
  const match = /^Pages:\s+(\d+)/m.exec(info);
  if (!match) throw new Error('Could not read the PDF.');
  return Number(match[1]);
}

/** Pages 1..count as JPEGs no wider than 1600 px, in page order. */
export async function renderPages(pdf: string, count: number, outDir: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  await exec('pdftoppm', ['-f', '1', '-l', String(count), '-jpeg', '-jpegopt', 'quality=82', '-scale-to', '1600', pdf, join(outDir, 'page')], 10 * 60_000);
  const files = (await readdir(outDir)).filter(f => /^page-\d+\.jpg$/.test(f));
  return files.sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0])).map(f => join(outDir, f));
}

export async function pageText(pdf: string, page: number): Promise<string> {
  return (await exec('pdftotext', ['-f', String(page), '-l', String(page), '-layout', '-enc', 'UTF-8', pdf, '-'], 60_000))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Any supported image -> a JPEG no larger than 1568 px, the size the model reads at. */
export async function normaliseImage(input: string, output: string, convert?: 'heif' | 'svg' | 'magick'): Promise<void> {
  let source = input;
  if (convert === 'heif') {
    source = `${output}.png`;
    await exec('heif-convert', [input, source], 120_000);
  } else if (convert === 'svg') {
    source = `${output}.png`;
    await exec('rsvg-convert', ['-w', '1568', '-b', 'white', '-o', source, input], 120_000);
  }
  await exec('convert', [`${source}[0]`, '-auto-orient', '-background', 'white', '-alpha', 'remove', '-resize', '1568x1568>', '-quality', '85', output], 120_000);
}

/** Mono 16 kHz FLAC: the smallest thing Transcribe transcribes as well as the original. */
export async function extractAudio(input: string, output: string): Promise<void> {
  await exec('ffmpeg', ['-y', '-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', output], 12 * 60_000);
}

/**
 * A browser-playable MP4. Remuxing (no re-encode) handles most .mov files from
 * phones and Zoom in seconds; only if that fails is the video re-encoded.
 */
export async function makePlayable(input: string, output: string, deadlineMs: number): Promise<boolean> {
  try {
    await exec('ffmpeg', ['-y', '-v', 'error', '-i', input, '-c', 'copy', '-movflags', '+faststart', output], Math.min(deadlineMs, 3 * 60_000));
    return true;
  } catch {
    try {
      await exec('ffmpeg', [
        '-y', '-v', 'error', '-i', input, '-vf', 'scale=-2:min(720\\,ih)', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output,
      ], deadlineMs);
      return true;
    } catch {
      return false;
    }
  }
}
