import React from 'react';

/** 5x5 bitmap glyphs for the letters the wordmark uses. '#' is a filled cell. */
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  C: ['#####', '#....', '#....', '#....', '#####'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  S: ['#####', '#....', '#####', '....#', '#####'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
};

const WORD = 'ACCESSLENS';
const CELL = 5;
const GAP = 1;

function pixelPath(word: string): string {
  let d = '';
  [...word].forEach((letter, index) => {
    const x0 = index * (CELL + GAP);
    GLYPHS[letter].forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === '#') d += `M${x0 + x} ${y}h1v1h-1z`;
      });
    });
  });
  return d;
}

const PATH = pixelPath(WORD);
const WIDTH = WORD.length * (CELL + GAP) - GAP;

/**
 * The product name as a pixel-grid wordmark. The heading's accessible name is
 * the real text, visually hidden; the drawing is decorative.
 */
export function Wordmark(): React.ReactElement {
  return (
    <h1 className="wordmark">
      <span className="visually-hidden">AccessLens</span>
      <svg viewBox={`0 0 ${WIDTH} ${CELL}`} aria-hidden="true" focusable="false" shapeRendering="crispEdges">
        <path d={PATH} fill="currentColor" />
      </svg>
    </h1>
  );
}
