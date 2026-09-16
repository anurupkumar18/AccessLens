/**
 * Page-anchored library chunking (spec §9.1).
 *
 * A PDF tokenizer would add a dependency and make chunk boundaries vary with
 * the runtime. We therefore use a deliberately conservative deterministic
 * approximation: one whitespace-delimited word is one token. The named
 * constants make the fixed target and overlap explicit and testable. Chunks
 * are formed independently for each page, never by a window over the whole
 * document, and their text is always an exact substring of the page text.
 */

/** The fixed target from the course-library contract. */
export const CHUNK_TOKEN_TARGET = 700;
/** The fixed page-local overlap from the course-library contract. */
export const CHUNK_TOKEN_OVERLAP = 100;

export interface ChunkPage {
  page: number;
  text: string;
}

export interface Chunk {
  chunkId: string;
  page: number;
  charStart: number;
  charEnd: number;
  text: string;
}

interface TokenSpan {
  start: number;
  end: number;
}

/** A small stable hash used only to make chunk ids distinguish same-position chunks. */
function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function tokenSpans(text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const matcher = /\S+/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/**
 * Split each page into fixed-size, overlapping chunks without crossing page
 * boundaries. Empty and whitespace-only pages intentionally yield no chunks.
 */
export function chunkPages(pages: readonly ChunkPage[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const page of pages) {
    const spans = tokenSpans(page.text);
    if (spans.length === 0) continue;

    let startToken = 0;
    let ordinal = 0;
    while (startToken < spans.length) {
      const endToken = Math.min(startToken + CHUNK_TOKEN_TARGET, spans.length);
      const charStart = spans[startToken].start;
      const charEnd = spans[endToken - 1].end;
      const text = page.text.slice(charStart, charEnd);
      chunks.push({
        // The page and ordinal make the location obvious; the content hash
        // prevents collisions when two documents have the same page layout.
        chunkId: `p${page.page}-c${ordinal}-${stableHash(text)}`,
        page: page.page,
        charStart,
        charEnd,
        text,
      });
      if (endToken === spans.length) break;
      startToken = endToken - CHUNK_TOKEN_OVERLAP;
      ordinal += 1;
    }
  }
  return chunks;
}
