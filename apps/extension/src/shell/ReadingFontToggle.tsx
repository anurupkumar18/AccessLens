import React, { useEffect, useState } from 'react';
import { readChoice, writeChoice } from './localChoice';

const STORAGE_KEY = 'accesslens-reading-font';

/**
 * Switches every page of the extension to OpenDyslexic with wider letter,
 * word, and line spacing, and turns off all-caps labels. It is a reading
 * choice anyone can make, not a disability flag: it is stored on this device
 * only and never leaves it.
 */
export function ReadingFontToggle(): React.ReactElement {
  const [on, setOn] = useState(() => readChoice(STORAGE_KEY, ['dyslexic'] as const) === 'dyslexic');

  useEffect(() => {
    if (on) document.documentElement.dataset.reading = 'dyslexic';
    else delete document.documentElement.dataset.reading;
  }, [on]);

  function toggle(): void {
    setOn(!on);
    writeChoice(STORAGE_KEY, on ? null : 'dyslexic');
  }

  return (
    <button type="button" className="reading-toggle" aria-pressed={on} onClick={toggle}>
      Dyslexia-friendly text
    </button>
  );
}
