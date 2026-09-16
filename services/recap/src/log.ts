/**
 * Redacted operational logging, mirrored from `services/live-session/src/log.ts`.
 *
 * This service sees more lesson content than any other in the product: a whole
 * window of the event timeline plus the captions of everything that was said
 * while the student was lost. A single `console.log(request)` here would put a
 * transcript of the class into CloudWatch.
 *
 * So the posture is copied rather than re-derived. There is no code path that
 * logs an event object or a caption. `logEvent` takes an event and emits only
 * the allowlisted operational fields; the content-bearing ones -- `assetId`,
 * `regionId`, `pointer`, `arState`, `caption` -- are dropped by construction,
 * not by remembering to omit them. `log.info` takes scalars only, so the
 * outline and the recap text have no type-legal way through it.
 *
 * The allowlist is deliberately identical to the relay's. A field that is too
 * sensitive to log when it is relayed does not become safe to log when it is
 * summarised, and a divergence between the two lists is the kind of thing that
 * happens silently. `test/handler.test.ts` asserts this one has not grown.
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
