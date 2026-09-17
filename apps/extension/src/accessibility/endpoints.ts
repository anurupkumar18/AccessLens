/**
 * Where the accessibility services live.
 *
 * Same resolution order as the orb: a value in `chrome.storage.local` wins,
 * otherwise the value baked in at build time. The deployed endpoints change
 * every time the temporary account is rebuilt, so a build-time constant alone
 * would strand anyone holding an older build, and storage alone would mean a
 * fresh install does nothing until someone configures it.
 */

interface ExtensionApis {
  storage?: { local?: { get(keys: string[] | string): Promise<Record<string, unknown>> } };
}
declare const chrome: ExtensionApis | undefined;

export type ServiceName = 'captions' | 'recap' | 'translate' | 'courseMedia';

const BUILT_IN: Record<ServiceName, string> = {
  captions: import.meta.env?.VITE_ACCESSLENS_CAPTIONS_ENDPOINT ?? '',
  recap: import.meta.env?.VITE_ACCESSLENS_RECAP_ENDPOINT ?? '',
  translate: import.meta.env?.VITE_ACCESSLENS_TRANSLATE_ENDPOINT ?? '',
  courseMedia: import.meta.env?.VITE_ACCESSLENS_COURSE_MEDIA_ENDPOINT ?? '',
};

const STORAGE_KEY: Record<ServiceName, string> = {
  captions: 'captionsEndpoint',
  recap: 'recapEndpoint',
  translate: 'translateEndpoint',
  courseMedia: 'courseMediaEndpoint',
};

export async function resolveEndpoint(service: ServiceName): Promise<string> {
  try {
    const store = typeof chrome !== 'undefined' ? chrome?.storage?.local : undefined;
    if (store) {
      const stored = await store.get(STORAGE_KEY[service]);
      const value = stored[STORAGE_KEY[service]];
      if (typeof value === 'string' && value) return value;
    }
  } catch {
    // Fall through to the built-in default.
  }
  return BUILT_IN[service];
}

export class ServiceUnavailable extends Error {}

/**
 * One place that knows how to call these services, so a failure is reported
 * the same way everywhere. A student who presses a button and gets silence
 * cannot tell a broken feature from a slow one.
 */
export async function callService<T>(
  service: ServiceName,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const endpoint = await resolveEndpoint(service);
  if (!endpoint) {
    throw new ServiceUnavailable(
      'This feature is not set up yet. Ask whoever installed AccessLens to add the service address.',
    );
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ServiceUnavailable('Could not reach the service. Check your connection.');
  }

  if (!response.ok) {
    // The services return a readable `error` for the cases a student can act
    // on, like "not enough text on this page"; prefer it over a status code.
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: string }).error ?? '';
    } catch {
      /* body was not JSON */
    }
    throw new ServiceUnavailable(detail || `The service returned ${response.status}.`);
  }

  return (await response.json()) as T;
}
