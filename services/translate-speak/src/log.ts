/**
 * Redacted operational logging, mirroring `services/live-session/src/log.ts`.
 *
 * This service handles the one thing the charter is most careful about: the
 * actual words of an instructor's reviewed course material, plus whichever
 * language a particular student needs it in. Both are exactly what must not end
 * up in CloudWatch — the text because it is the lesson, the pairing of text and
 * language because it is a per-student behavioural record.
 *
 * So, like the relay, there is no code path here that can log a request object.
 * `logOperation` projects whatever it is handed down to `OPERATIONAL_FIELDS`
 * before emitting, which means the failure mode is a *missing* field in a log
 * line, never a leaked one. A `console.log(request)` added at 3am is the thing
 * this design is defending against, and the projection is what makes forgetting
 * safe rather than catastrophic.
 *
 * `event` is deliberately the only free-form field, and its values are fixed
 * string literals chosen in this codebase — never anything derived from the
 * request. That is also why AWS error names are not logged: adding a `reason`
 * field would widen the allowlist, and a Polly/Translate error name is
 * recoverable from the metric and the status code instead.
 */

/** The only fields that may reach a log line. Widening this is a charter decision. */
const OPERATIONAL_FIELDS = ['event', 'targetLang', 'chars', 'spoke'] as const;

export type OperationalField = (typeof OPERATIONAL_FIELDS)[number];

/**
 * What a caller may pass. The index signature exists so that handing this
 * function a wider object is a compile-time *non*-error and a runtime drop,
 * rather than a type error someone silences with a cast that also defeats the
 * projection.
 */
export interface LogInput {
  event: string;
  targetLang?: string;
  chars?: number;
  spoke?: boolean;
  [key: string]: unknown;
}

/**
 * Reduce an arbitrary object to the allowlisted fields.
 *
 * Exported separately from the emitter so the redaction rule can be tested as a
 * pure function, without spying on `console`.
 */
export function project(input: LogInput): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {};
  for (const field of OPERATIONAL_FIELDS) {
    const value = input[field];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields[field] = value;
    }
  }
  return fields;
}

/** Emit one redacted JSON line. */
export function logOperation(input: LogInput): void {
  console.log(JSON.stringify(project(input)));
}

/** Exported for the test that asserts the allowlist has not quietly grown. */
export const REDACTION_ALLOWLIST: readonly string[] = OPERATIONAL_FIELDS;
