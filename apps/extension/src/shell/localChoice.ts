/**
 * Per-device display choices (theme, reading font). They live in this
 * browser's localStorage only: never sent to the relay, the instructor, or
 * the AWS session (charter A6). Storage can be unavailable or throw in private
 * windows or with site data blocked, so reads fall back to null and writes to
 * a no-op; the choice then lasts for the page only.
 */
export function readChoice<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : null;
  } catch {
    return null;
  }
}

export function writeChoice(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* remembered for this page only */
  }
}
