/**
 * The catch-up endpoint: one button, a short answer to "what did I miss".
 *
 * The failure this exists for is shared by students who otherwise have nothing
 * in common. The ADHD student's attention went somewhere else for ninety
 * seconds. The non-native speaker hit a word they had to think about and the
 * class moved on without them. The deaf student's interpreter or caption feed
 * lagged. The blind student's screen reader was still finishing the previous
 * slide. All four end up in the same place: the thread is gone, and the only
 * ways back in are to interrupt the class or to ask a neighbour. This gives
 * them a third one that costs nobody else anything.
 *
 * What it deliberately does NOT do:
 *   - store anything. Events and captions are used to answer and then dropped.
 *   - log lesson content. Only counts and outcomes reach CloudWatch; see
 *     `log.ts`, whose allowlist is copied from the relay rather than re-derived.
 *   - claim review. Everything the model writes is unverified generated text,
 *     labelled as such before a student reads or hears it.
 *   - throw. A Lambda Function URL that throws answers without CORS headers, so
 *     the browser reports an opaque network error and the student sees a
 *     spinner that never resolves. Every path here returns a response.
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { log, logEvent } from './log.js';
import { coverage, summariseTimeline, type LiveEvent, type RecapPack } from './timeline.js';

export {
  coverage,
  selectTimeline,
  summariseTimeline,
  type Coverage,
  type LiveEvent,
  type PackAsset,
  type PackRegion,
  type RecapPack,
} from './timeline.js';

/**
 * Only this model is invocable in the hackathon account -- every other
 * Anthropic model listed there returns AccessDenied. Overridable so a different
 * account does not need a code change.
 */
const MODEL_ID = process.env.RECAP_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';

/**
 * The exact wording used everywhere else generated content reaches a student
 * (`apps/extension/src/orb/provenance.ts`). Copied verbatim, not paraphrased: a
 * disclaimer a student learns to recognise in one surface has to be the same
 * string in the next, or it reads as a different, weaker claim.
 */
const GENERATED_NOTICE = 'AI-generated. Not reviewed by your instructor. May be wrong.';

/**
 * The no-model path says nothing a model wrote, so labelling it AI-generated
 * would be false in the direction that matters least but erodes the notice
 * fastest -- a warning attached to things that are not risky stops being read.
 * It is not reviewed instructor material either, so it gets its own honest line
 * rather than borrowing one of the two in `provenance.ts`.
 */
const NO_AI_NOTICE = 'No AI was used for this message.';

/** Roughly a class period of speech. Past this the oldest captions are dropped,
 *  because the student asked what they missed, not for a transcript. */
const MAX_CAPTION_CHARS = 8000;
/** A pathological client could post its entire buffer; the outline is what the
 *  model actually reads, so it is capped independently. */
const MAX_OUTLINE_CHARS = 6000;
const MAX_EVENTS = 5000;
const MAX_CAPTIONS = 2000;

/**
 * Every cap in this file keeps the *end* of its input. A client that posts its
 * whole session buffer with a recent `sinceSequence` has the events the recap
 * needs at the tail; taking the head would discard exactly the window being
 * asked about and answer confidently from the wrong part of the class.
 */
const tail = <T>(items: readonly T[], limit: number): T[] => items.slice(-limit);

const bedrock = new BedrockRuntimeClient({});

const SYSTEM = [
  'You help a student who lost the thread during a live class catch up in a few seconds.',
  'They may have looked away, missed audio, or fallen behind a screen reader.',
  'Use only the lesson outline and captions you are given.',
  'If they do not contain enough to say what happened, say that plainly instead of inventing material.',
  'Never claim an instructor reviewed, approved, or endorsed what you write.',
].join(' ');

const INSTRUCTION = [
  'Tell the student what they missed.',
  'Three sentences at most. Lead with the single thing that matters most.',
  'Use plain, everyday language and short sentences; the student may be reading in a second language.',
  'Do not use markdown, headings, bullet points, asterisks, or numbered lists.',
  'This text is read aloud by a screen reader, which speaks the punctuation.',
  'Write continuous prose only.',
  'If the material below is too thin to say what happened, say exactly that in one sentence.',
].join(' ');

export interface CaptionChunk {
  text?: string;
  isFinal?: boolean;
}

export interface RecapRequest {
  events?: LiveEvent[];
  captions?: CaptionChunk[];
  pack?: RecapPack;
  sinceSequence?: number;
}

export interface HttpEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}

const CORS = {
  // The student client is a browser extension running on whatever page the
  // class is on, plus the standalone student view, so the origin is genuinely
  // arbitrary. The endpoint holds no user data and authorises nothing by origin.
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
};

const json = (status: number, body: unknown) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

/**
 * Flatten captions into the text the model sees.
 *
 * Interim results are dropped. A streaming transcriber emits the same sentence
 * three or four times as it revises it, so feeding interims to the model both
 * wastes most of the caption budget on duplicates and makes a half-heard phrase
 * look like something the instructor repeated for emphasis.
 *
 * The cap keeps the *end* of the window rather than the start: the student is
 * furthest behind on what was said most recently.
 */
export function joinCaptions(captions: readonly CaptionChunk[] | undefined): string {
  const finals: string[] = [];
  for (const chunk of tail(captions ?? [], MAX_CAPTIONS)) {
    if (chunk?.isFinal === false) continue;
    const text = typeof chunk?.text === 'string' ? chunk.text.trim() : '';
    if (text) finals.push(text);
  }
  const joined = finals.join(' ');
  return joined.length > MAX_CAPTION_CHARS ? joined.slice(-MAX_CAPTION_CHARS) : joined;
}

export async function handler(event: HttpEvent) {
  try {
    return await respond(event);
  } catch (error) {
    // Backstop. Nothing below is expected to throw, but an unhandled throw from
    // a Function URL loses the CORS headers with it, and a student staring at a
    // stuck spinner has no way to know the button failed.
    log.error('recap-unhandled', { reason: (error as Error)?.name ?? 'Unknown' });
    return json(500, { error: 'The catch-up service failed.' });
  }
}

async function respond(event: HttpEvent) {
  const method = event.requestContext?.http?.method;
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (method && method !== 'POST') {
    return json(405, { error: 'Use POST.' });
  }

  let request: RecapRequest;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '{}');
    request = JSON.parse(raw || '{}') as RecapRequest;
  } catch {
    return json(400, { error: 'Body must be JSON.' });
  }

  const events = Array.isArray(request.events) ? tail(request.events, MAX_EVENTS) : [];
  const sinceSequence =
    typeof request.sinceSequence === 'number' && Number.isFinite(request.sinceSequence)
      ? request.sinceSequence
      : undefined;
  const pack = request.pack;

  const covered = coverage(events, sinceSequence);
  const full = summariseTimeline(events, pack, sinceSequence);
  /**
   * A truncated outline is labelled as truncated. Handing the model a partial
   * window with no marker is how it ends up describing the first half of what
   * the student missed as though it were all of it -- which reads as confident
   * and complete, and is the one failure mode this service cannot afford.
   */
  const outline =
    full.length > MAX_OUTLINE_CHARS
      ? `(earlier beats in this window were omitted)\n${full.slice(-MAX_OUTLINE_CHARS)}`
      : full;
  const captionText = joinCaptions(request.captions);

  warnOnPackDrift(events, pack);

  /**
   * Nothing happened, so do not pay a model call to say so.
   *
   * The gate is "no slides moved AND nothing was said", not "no events". A
   * lecture where the instructor talks for four minutes over one slide produces
   * zero timeline events and is precisely the stretch a deaf or distracted
   * student most needs summarised; answering "nothing has changed" there would
   * be the exact failure this service exists to fix.
   */
  if (!outline && !captionText) {
    log.info('recap-noop', { events: events.length, sinceSequence: sinceSequence ?? -1 });
    return json(200, {
      text: 'Nothing has changed since you looked away. You have not missed anything.',
      provenance: 'none',
      notice: NO_AI_NOTICE,
      covered,
    });
  }

  const prompt = [
    INSTRUCTION,
    '',
    'What the instructor showed, in order:',
    outline || '(no slide or region changes were recorded in this window)',
    '',
    'What was said, as live captions:',
    captionText || '(no captions were available for this window)',
  ].join('\n');

  try {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM }],
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        // Three sentences needs far fewer tokens than this; the headroom is so a
        // truncated reply never reaches a screen reader mid-word.
        inferenceConfig: { maxTokens: 300, temperature: 0.2 },
      }),
    );

    const text = (response.output?.message?.content?.find(part => 'text' in part)?.text ?? '').trim();
    if (!text) {
      log.warn('recap-empty', { regionCount: covered.regionCount });
      return json(502, { error: 'The catch-up service could not summarise this yet.' });
    }

    // Counts and outcome only. No outline, no caption, no ids.
    log.info('recap-generated', {
      events: events.length,
      regionCount: covered.regionCount,
      outlineChars: outline.length,
      captionChars: captionText.length,
      replyChars: text.length,
    });

    return json(200, {
      text,
      provenance: 'generated',
      notice: GENERATED_NOTICE,
      covered,
    });
  } catch (error) {
    log.error('recap-failed', {
      reason: (error as Error)?.name ?? 'Unknown',
      regionCount: covered.regionCount,
    });
    return json(502, { error: 'The catch-up service could not reach the model.' });
  }
}

/**
 * Warn when the events and the pack are from different lessons.
 *
 * Worth a log line because the symptom is otherwise invisible: every id fails to
 * resolve, the outline degrades to raw slugs, and the student gets a vague recap
 * with no error anywhere. `logEvent` is used rather than `log.info` so that the
 * one place in this service tempted to print an id cannot.
 */
function warnOnPackDrift(events: readonly LiveEvent[], pack: RecapPack | undefined): void {
  if (!pack?.assets?.length) return;
  const known = new Set(pack.assets.map(asset => asset?.assetId));
  const stray = events.find(
    event => typeof event.assetId === 'string' && !known.has(event.assetId),
  );
  if (stray) logEvent('warn', 'recap-pack-mismatch', stray as Record<string, unknown>);
}
