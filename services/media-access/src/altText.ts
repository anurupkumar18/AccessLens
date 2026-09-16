/**
 * What an alt-text draft is, and how a model reply becomes one.
 *
 * Free of AWS imports so the rules a blind student depends on -- a description
 * must exist unless the image is decorative, and it must be short enough for a
 * screen reader to speak in one breath -- are testable without a credential.
 *
 * Every draft leaves this service unreviewed. The extension refuses to export
 * one until the instructor has read it (charter A3); nothing here is allowed to
 * imply otherwise.
 */

/** Screen readers handle longer, but past this an `alt` stops being scannable. */
export const MAX_ALT_CHARS = 250;
export const MAX_LONG_DESCRIPTION_CHARS = 2000;
export const MAX_CONTEXT_CHARS = 2500;

export const TOOL_NAME = 'submit_alt_text';

export interface AltTextDraft {
  decorative: boolean;
  altText: string;
  longDescription: string;
}

export const SYSTEM_PROMPT = [
  'You write draft alt text for images in university course materials. An instructor',
  'reviews every draft before any student reads it.',
  'Always answer by calling the submit_alt_text tool exactly once.',
  'Rules:',
  '- altText: one or two sentences, at most 150 characters where possible and never more',
  `  than ${MAX_ALT_CHARS}. Say what the image teaches in this context, not how it looks`,
  '  in general. Include any short text in the image that carries meaning. Do not begin',
  '  with "Image of" or "Picture of".',
  '- longDescription: for charts, graphs, tables, diagrams, equations, maps, and code,',
  '  a complete description of the information a sighted student would get: axes,',
  '  values, trends, labels, relationships, and steps. Plain prose, no markdown. For a',
  '  simple photo or illustration this is an empty string.',
  '- decorative: true only for images that add no information (borders, stock',
  '  backgrounds, logos repeated on every slide). Then altText and longDescription',
  '  are empty strings.',
  '- Describe only what is visible. If the image is unreadable or too small to',
  '  describe, say so in altText rather than guessing.',
  '- People may be described by what they are doing. Never infer or state anyone\'s',
  '  identity, gender, race, age, emotion, or disability.',
].join('\n');

/** JSON Schema for the forced tool call. */
export const TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decorative', 'altText', 'longDescription'],
  properties: {
    decorative: { type: 'boolean' },
    altText: { type: 'string' },
    longDescription: { type: 'string' },
  },
} as const;

export function userPrompt(context: string): string {
  const trimmed = context.trim().slice(0, MAX_CONTEXT_CHARS);
  return trimmed
    ? `Write alt text for this image. It appears in course material with this surrounding content:\n\n${trimmed}`
    : 'Write alt text for this image from course material. No surrounding content was provided.';
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max).trimEnd();
}

/**
 * The draft a tool call's input describes, or `undefined` if it is unusable.
 *
 * A non-decorative image with no alt text is refused rather than passed through:
 * an empty `alt` tells a screen reader to skip the image, which silently turns
 * a model failure into missing content.
 */
export function parseDraft(input: unknown): AltTextDraft | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const source = input as Record<string, unknown>;
  if (typeof source['decorative'] !== 'boolean') return undefined;
  if (source['decorative']) return { decorative: true, altText: '', longDescription: '' };

  const altText = typeof source['altText'] === 'string' ? clip(source['altText'], MAX_ALT_CHARS) : '';
  if (!altText) return undefined;
  const longDescription = typeof source['longDescription'] === 'string'
    ? source['longDescription'].trim().slice(0, MAX_LONG_DESCRIPTION_CHARS)
    : '';
  return { decorative: false, altText, longDescription };
}
