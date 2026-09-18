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

  it('keeps same-document url(#id) references, which is how arrowheads work', () => {
    // A blanket `url(` ban deleted marker-end from every diagram, so every
    // arrow in every flow chart vanished while the boxes stayed.
    const out = sanitiseSvg(wrap('<line x1="0" y1="0" x2="9" y2="0" stroke="#555" marker-end="url(#arrow)"/><defs><marker id="arrow"><path d="M0,0 L0,6 L8,3 z"/></marker></defs>'));
    expect(out).toContain('marker-end');
    expect(out).toContain('<marker');
  });

  it('still strips a url() that reaches outside the document', () => {
    expect(sanitiseSvg(wrap('<rect width="4" height="4" fill="url(https://evil.test/x)"/>'))).not.toContain('evil.test');
    expect(sanitiseSvg(wrap('<rect width="4" height="4" fill="url(//evil.test/x)"/>'))).not.toContain('evil.test');
  });

  it('derives an aspect ratio from the viewBox instead of stretching', () => {
    // Without this the mounted SVG had no intrinsic size and blew out to
    // 1784x1070 inside a 388px panel.
    const out = sanitiseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 420" width="9999" height="9999"><rect width="1" height="1"/></svg>');
    expect(out).toContain('aspect-ratio:700/420');
    expect(out).not.toContain('9999');
    expect(out).toContain('preserveAspectRatio');
  });

  it('refuses anything that is not an svg document', () => {
    expect(sanitiseSvg('<div>not an svg</div>')).toBeUndefined();
    expect(sanitiseSvg('utter nonsense <<<')).toBeUndefined();
  });

  it('marks the result as an image for assistive technology', () => {
    expect(sanitiseSvg(wrap('<rect width="1" height="1"/>'))).toContain('role="img"');
  });
});
