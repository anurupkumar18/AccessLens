/**
 * Redacted operational logging (A8), mirroring `services/live-session/src/log.ts`.
 *
 * This service is the one place in the system that holds a student's lecture in
 * plain text, which makes it the one place where a debugging `console.log` does
 * the most damage: `SYSTEM_DESIGN.md` §7 promises CloudWatch gets redacted
 * operational telemetry only, and a caption is the instructor's actual words.
 * Transcription is also fallible -- logging a mishearing attached to a session
 * id creates a durable record of something nobody said.
 *
 * So there is no code path here that can log a caption. `logEvent` takes the
 * whole event and projects it onto a hard allowlist; `caption` is dropped by
 * construction rather than by anyone remembering to omit it. What survives is
 * enough to answer "is transcription working": which session, which pack, which
 * sequence, which type.
 *
 * The allowlist is deliberately identical to Part 4's. Two services logging the
 * same event type through two different allowlists is how one of them quietly
 * becomes the leak.
 */

/** The only event fields that may reach a log line. */
const OPERATIONAL_FIELDS = ['type', 'sessionId', 'packId', 'packVersion', 'sequence'] as const;

type Level = 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: string | number | boolean | undefined;
}

function emit(level: Level, message: string, fields: LogFields): void {
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (message: string, fields: LogFields = {}) => emit('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => emit('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => emit('error', message, fields),
};

/**
 * Log something about an event without logging the event.
 *
 * Takes the whole event so callers never have to hand-pick fields -- the moment
 * they do, someone picks `caption` -- and projects it down to the allowlist here.
 */
export function logEvent(
  level: Level,
  message: string,
  // `object`, not `Record<string, unknown>`, so a precisely-typed event (which
  // has no index signature) can be passed without the caller reaching for a
  // cast -- a cast at the call site is one keystroke from becoming a cast that
  // hand-picks fields.
  event: object,
  extra: LogFields = {},
): void {
  const source = event as Record<string, unknown>;
  const fields: LogFields = {};
  for (const field of OPERATIONAL_FIELDS) {
    const value = source[field];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields[field] = value;
    }
  }
  emit(level, message, { ...fields, ...extra });
}

/** Exported for the test that asserts the allowlist has not quietly grown. */
export const REDACTION_ALLOWLIST: readonly string[] = OPERATIONAL_FIELDS;
