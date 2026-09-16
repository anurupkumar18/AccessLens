/**
 * Charter A9 was amended, not abandoned: the orb may invent, but never
 * silently. These tests are the mechanical half of that promise.
 */
import { describe, expect, it } from 'vitest';
import { GENERATED_NOTICE, generated, reviewed, speakableText } from './provenance';

describe('provenance', () => {
  it('attaches a non-empty notice to generated content', () => {
    const item = generated('The mitochondrion releases energy.');
    expect(item.provenance).toBe('generated');
    expect(item.notice).toBe(GENERATED_NOTICE);
    expect(item.notice.length).toBeGreaterThan(0);
  });

  it('says plainly that generated content is unreviewed and may be wrong', () => {
    expect(GENERATED_NOTICE.toLowerCase()).toContain('not reviewed');
    expect(GENERATED_NOTICE.toLowerCase()).toContain('may be wrong');
  });

  it('distinguishes reviewed content, which carries a different notice', () => {
    expect(reviewed('x').notice).not.toBe(GENERATED_NOTICE);
    expect(reviewed('x').provenance).toBe('reviewed');
  });

  it('speaks the warning before the content, not after', () => {
    const spoken = speakableText(generated('Photosynthesis uses light.'));
    expect(spoken.indexOf(GENERATED_NOTICE)).toBe(0);
    expect(spoken.indexOf('Photosynthesis')).toBeGreaterThan(GENERATED_NOTICE.length - 1);
  });

  it('uses only ASCII-safe wording in the notice', () => {
    // A stray non-Latin word slipped into this file once; a screen reader
    // switching language mid-sentence is a real accessibility failure.
    expect(GENERATED_NOTICE).toMatch(/^[\x20-\x7E’]+$/);
  });
});
