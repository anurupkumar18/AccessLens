/**
 * Redacted operational logging, same rule as the relay's `log.ts` (charter A4).
 *
 * A student's question, a model answer, a caption, and reviewed text are all
 * content. None of them has a code path to a log line: callers pass only the
 * allowlisted operational fields below, and anything else is dropped here.
 */
const ALLOWED = new Set(['route', 'status', 'reason', 'role', 'packId', 'durationMs', 'retrieved', 'cited']);

type Level = 'info' | 'warn' | 'error';

export function log(level: Level, message: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED.has(key) && value !== undefined) safe[key] = value;
  }
  const line = JSON.stringify({ level, message, ...safe });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
