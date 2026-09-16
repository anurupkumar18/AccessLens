// @vitest-environment jsdom
/**
 * The sanitiser matters more than anything else in the orb: it takes a string
 * a language model produced and puts it into the DOM of a page the student is
 * reading, on a site we do not control. These are the attacks it must survive.
 */
import { describe, expect, it } from 'vitest';
import { sanitiseSvg } from './explain';

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

describe('sanitiseSvg', () => {
  it('keeps ordinary drawing elements', () => {
    const out = sanitiseSvg(wrap('<circle cx="5" cy="5" r="4" fill="red"/>'));
    expect(out).toContain('circle');
    expect(out).toContain('fill="red"');
  });

  it('drops a script element entirely', () => {
    const out = sanitiseSvg(wrap('<script>alert(1)</script><rect width="4" height="4"/>'));
    expect(out).not.toContain('script');
    expect(out).toContain('rect');
  });

  it('strips event-handler attributes', () => {
    const out = sanitiseSvg(wrap('<rect width="4" height="4" onload="alert(1)" onclick="x()"/>'));
    expect(out).not.toMatch(/onload|onclick/i);
  });

  it('strips href and xlink, which can pull in external documents', () => {
    const out = sanitiseSvg(wrap('<a href="javascript:alert(1)"><rect width="1" height="1"/></a>'));
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('href');
  });

  it('strips javascript: and data: hidden inside style', () => {
    const out = sanitiseSvg(wrap('<rect width="4" height="4" style="background:url(javascript:alert(1))"/>'));
    expect(out).not.toContain('javascript:');
  });

  it('drops foreignObject, which can host arbitrary HTML', () => {
    const out = sanitiseSvg(wrap('<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">hi</body></foreignObject>'));
    expect(out).not.toContain('foreignObject');
  });

  it('keeps declarative animation, which is the point of a diagram', () => {
    const out = sanitiseSvg(wrap('<circle r="2"><animate attributeName="r" to="4" dur="1s"/></circle>'));
    expect(out).toContain('animate');
  });

  it('refuses anything that is not an svg document', () => {
    expect(sanitiseSvg('<div>not an svg</div>')).toBeUndefined();
    expect(sanitiseSvg('utter nonsense <<<')).toBeUndefined();
  });

  it('marks the result as an image for assistive technology', () => {
    expect(sanitiseSvg(wrap('<rect width="1" height="1"/>'))).toContain('role="img"');
  });
});
