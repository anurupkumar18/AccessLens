/**
 * Transcribe's WebVTT output -> transcript cues for the clickable transcript.
 *
 * The .vtt file itself is what the video player loads; this parse only feeds
 * the text transcript beside it, so a cue it cannot read is skipped rather than
 * failing the whole item.
 */
import type { Cue } from './manifest.js';

function seconds(stamp: string): number | undefined {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(stamp.trim());
  const [, h, m, s, ms] = match ?? [];
  if (m === undefined || s === undefined || ms === undefined) return undefined;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of vtt.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timing = lines.findIndex(line => line.includes('-->'));
    if (timing < 0) continue;
    const [from = '', to = ''] = (lines[timing] ?? '').split('-->');
    const start = seconds(from);
    const end = seconds(to.trim().split(/\s+/)[0] ?? '');
    const text = lines.slice(timing + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (start === undefined || end === undefined || !text) continue;
    cues.push({ start, end, text });
  }
  return cues;
}
