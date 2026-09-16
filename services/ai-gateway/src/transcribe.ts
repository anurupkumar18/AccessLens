import { HttpRequest } from '@smithy/protocol-http';

export const TRANSCRIBE_SAMPLE_RATE = 16000;
export const TRANSCRIBE_URL_TTL_SECONDS = 300;

/** The part of Smithy's SignatureV4 this needs: a signed path and query back. */
export interface Presigner {
  presign(request: HttpRequest, options: { expiresIn: number; signingDate?: Date }): Promise<{ path: string; query?: Record<string, string | string[] | null | undefined> }>;
}

/** RFC 3986 escaping, which SigV4's canonical query uses (encodeURIComponent leaves !'()* alone). */
const escape = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * A short-lived presigned WebSocket URL for Amazon Transcribe streaming.
 *
 * The instructor's browser connects straight to Transcribe with it, so the
 * microphone audio goes browser -> Transcribe and never through the relay or
 * this Lambda, and no AWS credential ever reaches the extension: the URL is
 * signed here with the function's role and expires in five minutes. Only the
 * resulting caption text travels on the live contract. This is the remote
 * audio processing charter A2 requires a recorded decision and visible consent
 * for; see services/ai-gateway/README.md.
 */
export async function presignTranscribeUrl(signer: Presigner, region: string, signingDate?: Date): Promise<string> {
  const hostname = `transcribestreaming.${region}.amazonaws.com`;
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'wss:',
    hostname,
    port: 8443,
    path: '/stream-transcription-websocket',
    headers: { host: `${hostname}:8443` },
    query: {
      'language-code': 'en-US',
      'media-encoding': 'pcm',
      'sample-rate': String(TRANSCRIBE_SAMPLE_RATE),
      'enable-partial-results-stabilization': 'true',
      'partial-results-stability': 'medium',
    },
  });
  const signed = await signer.presign(request, { expiresIn: TRANSCRIBE_URL_TTL_SECONDS, signingDate });
  const query = Object.entries(signed.query ?? {})
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string').map(v => `${escape(key)}=${escape(v)}`))
    .join('&');
  return `wss://${hostname}:8443${signed.path}?${query}`;
}
