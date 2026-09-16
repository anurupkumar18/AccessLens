/**
 * The orb's explanation endpoint.
 *
 * Exists because the extension must never hold AWS credentials -- a bundle
 * anyone can unzip is the wrong place for them (`SYSTEM_DESIGN.md` §10). The
 * model call happens here instead, behind a Function URL the content script can
 * reach from any page.
 *
 * What this deliberately does NOT do:
 *   - store anything. No request or response is written anywhere. The page text
 *     a student sends is used to answer and then dropped.
 *   - log page content. Only the mode, the byte count, and the outcome reach
 *     CloudWatch, matching the redaction posture of the relay service.
 *   - claim review. Everything it returns is unverified generated text, which
 *     the extension labels before a student sees or hears it.
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

/**
 * Only this model is invocable in the hackathon account -- every other
 * Anthropic model listed there returns AccessDenied. Overridable so a different
 * account does not need a code change.
 */
const MODEL_ID = process.env.ORB_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
const MAX_INPUT_CHARS = 6000;

const bedrock = new BedrockRuntimeClient({});

export type ExplainMode = 'explain' | 'simplify' | 'diagram';

const INSTRUCTIONS: Record<ExplainMode, string> = {
  explain:
    'Explain the key concept on this page for a university student who may have a ' +
    'print disability, low vision, or a learning difference. Lead with the single most ' +
    'important idea in one sentence, then add two or three sentences of support. ' +
    'Use plain language. Do not use markdown, headings, or bullet points; this text ' +
    'will be read aloud by a screen reader.',
  simplify:
    'Restate the key concept on this page in the simplest accurate language you can. ' +
    'Short sentences. Everyday words. Keep it true -- do not simplify it into something ' +
    'that is wrong. Four sentences at most. No markdown; this will be read aloud.',
  diagram:
    'Produce a simple, labelled SVG diagram of the key concept on this page, then one ' +
    'short paragraph describing the same thing in words for someone who cannot see it. ' +
    'Return the SVG first inside a ```svg fenced block, then the paragraph. Write the ' +
    'paragraph as plain prose with no markdown, no asterisks and no backticks; it is read ' +
    'aloud by screen readers. The SVG must ' +
    'use a viewBox, no scripts, no external references, and readable font sizes.',
};

const SYSTEM = [
  'You help disabled students understand course material they are reading.',
  'Explain only what the supplied page text actually says. If it is too fragmentary',
  'to explain, say so plainly rather than inventing material. Never claim an',
  'instructor reviewed or endorsed your answer.',
].join(' ');

export interface ExplainRequest {
  mode?: string;
  title?: string;
  url?: string;
  text?: string;
}

function isMode(value: unknown): value is ExplainMode {
  return value === 'explain' || value === 'simplify' || value === 'diagram';
}

/**
 * Split the model's reply into prose and an SVG, tolerating a truncated one.
 *
 * The earlier version required a closing fence. When a rich page pushed the
 * reply past the token cap the fence never closed, the match failed, and the
 * raw ```svg plus half an SVG was rendered into the panel as body text --
 * which is what a student actually saw on a real Canvas page.
 *
 * A half-written SVG cannot be salvaged: it is markup with unclosed tags, and
 * the sanitiser would reject it anyway. So a truncated diagram degrades to the
 * prose, which is the accessible route and the one that has to survive.
 */
export function splitSvg(reply: string): { text: string; svg?: string; truncated?: boolean } {
  const closed = reply.match(/```svg\s*([\s\S]*?)```/i);
  if (closed) {
    const svg = closed[1].trim();
    const text = reply.replace(closed[0], '').trim();
    return { text: text || 'A diagram of the concept on this page.', svg };
  }

  const opening = reply.match(/```svg\s*/i);
  if (opening) {
    // Everything from the opening fence on is an unusable partial SVG. Keep
    // whatever prose came before or after it, and say the diagram failed
    // rather than showing markup to someone who asked for a picture.
    const prose = reply.slice(0, opening.index ?? 0).trim();
    return {
      text: prose || 'This page was too long to draw. Try selecting just the part you want explained.',
      truncated: true,
    };
  }

  return { text: reply.trim() };
}

export interface HttpEvent {
  body?: string | null;
  requestContext?: { http?: { method?: string } };
}

/**
 * CORS is owned by the Function URL, not by this handler.
 *
 * Both used to set it, and a response carrying two `Access-Control-Allow-Origin`
 * headers is rejected outright by browsers -- the request fails CORS and `fetch`
 * throws, which reaches a student as "could not reach the service". It was
 * invisible to every curl test, because curl does not enforce CORS at all.
 *
 * The Function URL answers the preflight itself, so OPTIONS never reaches this
 * code. The constant stays so response shapes are unchanged; it is just empty.
 */
const CORS: Record<string, string> = {};

const json = (status: number, body: unknown) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

export async function handler(event: HttpEvent) {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  let request: ExplainRequest;
  try {
    request = JSON.parse(event.body ?? '{}') as ExplainRequest;
  } catch {
    return json(400, { error: 'Body must be JSON.' });
  }

  const mode = isMode(request.mode) ? request.mode : 'explain';
  const text = typeof request.text === 'string' ? request.text.slice(0, MAX_INPUT_CHARS).trim() : '';
  if (text.length < 40) {
    return json(400, { error: 'Not enough readable text on this page to explain.' });
  }

  const title = typeof request.title === 'string' ? request.title.slice(0, 200) : '';

  try {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM }],
        messages: [
          {
            role: 'user',
            content: [
              {
                text: `${INSTRUCTIONS[mode]}\n\nPage title: ${title}\n\nPage text:\n${text}`,
              },
            ],
          },
        ],
        // 1600 truncated real Canvas pages mid-SVG. A labelled diagram plus its
        // written description runs longer than it looks.
        inferenceConfig: { maxTokens: mode === 'diagram' ? 4000 : 500, temperature: 0.2 },
      }),
    );

    const reply = response.output?.message?.content?.find(part => 'text' in part)?.text ?? '';
    if (!reply.trim()) return json(502, { error: 'The model returned nothing usable.' });

    // Content is never logged; the shape of the call is.
    console.log(JSON.stringify({ event: 'explained', mode, inputChars: text.length }));
    return json(200, splitSvg(reply));
  } catch (error) {
    console.log(
      JSON.stringify({ event: 'explain_failed', mode, reason: (error as Error)?.name ?? 'Unknown' }),
    );
    return json(502, { error: 'The explanation service could not reach the model.' });
  }
}
