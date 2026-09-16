/**
 * Redacted operational logging (A8).
 *
 * `SYSTEM_DESIGN.md` §7 says CloudWatch gets "redacted operational telemetry"
 * with field allowlists, and the charter forbids the relay from retaining
 * lesson content. The easy way to violate both is one `console.log(event)`
 * added at 3am while debugging, which is exactly when it would be added.
 *
 * So there is no code path here that logs an event object. `logEvent` takes an
 * event and emits only the allowlisted operational fields; the content-bearing
 * ones -- `assetId`, `regionId`, `pointer`, `arState`, `caption` -- are dropped
 * by construction rather than by remembering to omit them. What is left is
 * enough to answer "is the relay working": which session, which type, which
 * sequence, how long it took.
 *
 * `assetId` and `regionId` are reviewed content, not secrets, but they are
 * still what the instructor is teaching and when. Logging them would let anyone
 * with CloudWatch access reconstruct the lesson, and a per-session record of
 * what was shown is the beginning of exactly the behavioural data the charter
 * rules out.
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
 * Takes the whole event so callers never have to hand-pick fields (the moment
 * they do, someone picks `caption`), and projects it down to the allowlist here.
 */
export function logEvent(
  level: Level,
  message: string,
  event: Record<string, unknown>,
  extra: LogFields = {},
): void {
  const fields: LogFields = {};
  for (const field of OPERATIONAL_FIELDS) {
    const value = event[field];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields[field] = value;
    }
  }
  emit(level, message, { ...fields, ...extra });
}

/** Exported for the test that asserts the allowlist has not quietly grown. */
export const REDACTION_ALLOWLIST: readonly string[] = OPERATIONAL_FIELDS;
