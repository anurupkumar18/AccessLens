import { describe, expect, it } from 'vitest';
import { splitSvg } from '../src/handler';

describe('splitSvg', () => {
  it('returns plain text unchanged when there is no diagram', () => {
    const out = splitSvg('The mitochondrion releases energy.');
    expect(out.text).toBe('The mitochondrion releases energy.');
    expect(out.svg).toBeUndefined();
  });

  it('separates a fenced svg block from the description', () => {
    const out = splitSvg('```svg\n<svg viewBox="0 0 10 10"><circle r="2"/></svg>\n```\nA circle.');
    expect(out.svg).toContain('<svg');
    expect(out.text).toBe('A circle.');
  });

  it('never leaves the text empty, since it is the accessible route', () => {
    // A model that returns only a diagram would otherwise strand a
    // screen-reader user with nothing to read.
    const out = splitSvg('```svg\n<svg viewBox="0 0 1 1"/>\n```');
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.svg).toContain('<svg');
  });

  it('degrades a truncated diagram to prose instead of showing raw markup', () => {
    // The real failure: a long Canvas page pushed the reply past the token cap,
    // the fence never closed, and the panel rendered ```svg plus half an SVG as
    // body text. A half-written SVG cannot be salvaged, so the prose has to
    // carry it -- and that is the accessible route anyway.
    const out = splitSvg('Here is the pipeline.\n```svg\n<svg viewBox="0 0 10 10"><rect width="140" height="');
    expect(out.svg).toBeUndefined();
    expect(out.truncated).toBe(true);
    expect(out.text).toBe('Here is the pipeline.');
    expect(out.text).not.toContain('```');
    expect(out.text).not.toContain('<svg');
  });

  it('still says something useful when truncation leaves no prose at all', () => {
    const out = splitSvg('```svg\n<svg viewBox="0 0 10 10"><rect');
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeGreaterThan(20);
    expect(out.text).not.toContain('<svg');
  });

  it('is case-insensitive about the fence label', () => {
    expect(splitSvg('```SVG\n<svg/>\n```\nx').svg).toBe('<svg/>');
  });
});
