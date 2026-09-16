import type { FactCitation } from '../../shared/api';
import type { PageText } from './stages/types';

/** A citation-preserving draft candidate. It is never published automatically. */
export interface ExtractedClassFact {
  kind: 'deadline' | 'recap';
  title: string;
  body: string;
  dueAt?: string;
  occurredOn?: string;
  timeZone: string;
  citation: FactCitation;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Extract only explicit, line-local dates. This intentionally errs on the
 * side of omitting a candidate rather than guessing a course schedule.
 */
export function extractClassFactDrafts(input: { docId: string; title: string; timeZone: string; pages: readonly PageText[] }): ExtractedClassFact[] {
  const drafts: ExtractedClassFact[] = [];
  for (const page of input.pages) {
    for (const rawLine of page.text.split(/\r?\n/u)) {
      const line = rawLine.replace(/\s+/gu, ' ').trim();
      if (line.length < 8) continue;
      const date = explicitDate(line);
      const citation: FactCitation = { docId: input.docId, title: input.title, page: page.page, quote: line.slice(0, 300) };
      if (date && /\b(?:due|deadline|submit|submission)\b/iu.test(line)) {
        drafts.push({ kind: 'deadline', title: `Deadline: ${input.title}`, body: line, dueAt: zonedDateTime(date, explicitTime(line), input.timeZone), timeZone: input.timeZone, citation });
      } else if (date && /\b(?:recap|what we covered|class summary)\b/iu.test(line)) {
        drafts.push({ kind: 'recap', title: `Recap: ${input.title}`, body: line, occurredOn: date.iso, timeZone: input.timeZone, citation });
      }
    }
  }
  return [...new Map(drafts.map(draft => [`${draft.kind}:${draft.citation.page}:${draft.body}`, draft])).values()];
}

interface LocalDate { year: number; month: number; day: number; iso: string }

function explicitDate(text: string): LocalDate | undefined {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/u.exec(text);
  if (iso) return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const named = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/iu.exec(text);
  return named ? makeDate(Number(named[3]), MONTHS[named[1].toLowerCase()], Number(named[2])) : undefined;
}

function makeDate(year: number, month: number, day: number): LocalDate | undefined {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
    ? { year, month, day, iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
    : undefined;
}

function explicitTime(text: string): { hour: number; minute: number } {
  const match = /\b(?:at|by)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/iu.exec(text);
  if (!match) return { hour: 23, minute: 59 };
  let hour = Number(match[1]);
  const marker = match[3]?.replace(/\./gu, '').toLowerCase();
  if (marker === 'pm' && hour < 12) hour += 12;
  if (marker === 'am' && hour === 12) hour = 0;
  return { hour, minute: Number(match[2] ?? '0') };
}

/** Convert an explicit local due date/time to a UTC instant while retaining its IANA source zone. */
function zonedDateTime(date: LocalDate, time: { hour: number; minute: number }, timeZone: string): string {
  let utc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let attempts = 0; attempts < 2; attempts += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    utc += Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute) - observed;
  }
  return new Date(utc).toISOString();
}
