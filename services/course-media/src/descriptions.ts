/**
 * Alt text prompts and the rules for accepting what the model returns.
 *
 * Nothing is reviewed by a person before students see it (team decision,
 * RL-038), so these rules are the only gate: a figure with no alt text is
 * dropped rather than shown empty, lengths are bounded, and the prompt asks the
 * model to say when it cannot read something instead of guessing.
 */
import type { Figure } from './manifest.js';

export const MAX_ALT_CHARS = 300;
export const MAX_LONG_CHARS = 2500;
export const MAX_PAGE_TEXT_FOR_MODEL = 4000;
const MAX_FIGURES = 12;

const RULES = [
  'Describe only what is visible. If something is unreadable, say so rather than guessing.',
  'People may be described by what they are doing. Never infer or state identity, gender, race, age, emotion, or disability.',
  'Plain prose, no markdown. Do not begin with "Image of" or "Picture of".',
].join('\n');

export const IMAGE_SYSTEM = `You write alt text for images in university course materials. Students who use screen readers rely on it directly, with no human review.
Always answer by calling the submit_image tool exactly once.
- altText: one or two sentences, ideally under 150 characters, saying what the image teaches, including short meaningful text in it.
- longDescription: for charts, graphs, tables, diagrams, equations, maps, and code, the full information a sighted student gets (axes, values, trends, labels, steps). Empty string for simple photos.
- decorative: true only if the image carries no information (a border, a stock background). Then both texts are empty.
${RULES}`;

export const PAGE_SYSTEM = `You make one page of university course material (a slide or a document page) accessible to students who use screen readers. They rely on your output directly, with no human review.
Always answer by calling the submit_page tool exactly once.
- description: alt text for the page as a whole, one to three sentences: what the page is about and what its visuals show. Do not repeat all of the page text; the student also receives the exact text separately.
- figures: one entry per meaningful visual (photo, chart, diagram, table rendered as an image, equation, code screenshot). Skip logos, decorative shapes, and plain text boxes. For each: altText (under 150 characters where possible) and longDescription (full detail for charts, diagrams, tables and equations; empty string for simple photos).
${RULES}`;

export const IMAGE_TOOL = {
  name: 'submit_image',
  description: 'Submit alt text for this image.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['decorative', 'altText', 'longDescription'],
    properties: {
      decorative: { type: 'boolean' },
      altText: { type: 'string' },
      longDescription: { type: 'string' },
    },
  },
} as const;

export const PAGE_TOOL = {
  name: 'submit_page',
  description: 'Submit the accessible description of this page.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['description', 'figures'],
    properties: {
      description: { type: 'string' },
      figures: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['altText', 'longDescription'],
          properties: { altText: { type: 'string' }, longDescription: { type: 'string' } },
        },
      },
    },
  },
} as const;

const flat = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trimEnd() : '';

const long = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max).trimEnd() : '';

export function imagePrompt(fileName: string, className: string): string {
  return `Write alt text for this image, uploaded as "${fileName}"${className ? ` to the class "${className}"` : ''}.`;
}

export function pagePrompt(fileName: string, pageNumber: number, pageCount: number, pageText: string): string {
  const text = pageText.trim().slice(0, MAX_PAGE_TEXT_FOR_MODEL);
  return `This is page ${pageNumber} of ${pageCount} of "${fileName}".\n\nExact text extracted from the page:\n${text || '(no extractable text; the page may be an image)'}`;
}

export interface ImageDescription {
  decorative: boolean;
  altText: string;
  longDescription: string;
}

export function parseImage(input: unknown): ImageDescription | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const source = input as Record<string, unknown>;
  if (source['decorative'] === true) return { decorative: true, altText: '', longDescription: '' };
  const altText = flat(source['altText'], MAX_ALT_CHARS);
  if (!altText) return undefined;
  return { decorative: false, altText, longDescription: long(source['longDescription'], MAX_LONG_CHARS) };
}

export function parsePage(input: unknown): { description: string; figures: Figure[] } | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const source = input as Record<string, unknown>;
  const description = flat(source['description'], MAX_ALT_CHARS * 2);
  if (!description) return undefined;
  const figures = (Array.isArray(source['figures']) ? source['figures'] : [])
    .map(figure => {
      const f = (typeof figure === 'object' && figure !== null ? figure : {}) as Record<string, unknown>;
      return { altText: flat(f['altText'], MAX_ALT_CHARS), longDescription: long(f['longDescription'], MAX_LONG_CHARS) };
    })
    .filter(figure => figure.altText)
    .slice(0, MAX_FIGURES);
  return { description, figures };
}

/** What a student gets when the model fails on a page: its real text, and an honest note. */
export function fallbackPage(pageText: string): { description: string; figures: Figure[] } {
  return {
    description: pageText.trim()
      ? 'A description of this page could not be generated. Its text is below.'
      : 'A description of this page could not be generated, and the page has no extractable text.',
    figures: [],
  };
}
