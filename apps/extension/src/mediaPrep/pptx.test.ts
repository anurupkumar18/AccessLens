// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { altFieldText, isOfficeGeneratedAlt, readPptx, resolvePartPath, writePptxAltText } from './pptx';

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const pic = (id: number, rid: string, descr?: string) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"${descr === undefined ? '' : ` descr="${descr}"`}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill></p:pic>`;

const slide = (title: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld ${P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>${body}</p:spTree></p:cSld></p:sld>`;

const rels = (entries: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;

/**
 * Deck order is slide2 then slide1 -- the order must come from presentation.xml,
 * not file names. The logo appears on both slides, the chart has speaker notes,
 * one picture is an EMF, and one is linked rather than embedded.
 */
function deck(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'ppt/presentation.xml': strToU8(`<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': strToU8(rels(`<Relationship Id="rId2" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="${REL}/slide" Target="slides/slide2.xml"/>`)),
    'ppt/slides/slide1.xml': strToU8(slide('Krebs cycle', pic(4, 'rId1') + pic(5, 'rId2', 'Existing logo alt') + pic(6, 'rId3') + pic(7, 'rId4'))),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(rels(
      `<Relationship Id="rId1" Type="${REL}/image" Target="../media/chart.png"/>` +
      `<Relationship Id="rId2" Type="${REL}/image" Target="../media/logo.png"/>` +
      `<Relationship Id="rId3" Type="${REL}/image" Target="../media/formula.emf"/>` +
      `<Relationship Id="rId4" Type="${REL}/image" Target="https://example.edu/x.png" TargetMode="External"/>` +
      `<Relationship Id="rId9" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>`)),
    'ppt/notesSlides/notesSlide1.xml': strToU8(`<p:notes ${P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Point at the NADH output.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`),
    'ppt/slides/slide2.xml': strToU8(slide('Welcome', pic(2, 'rId1'))),
    'ppt/slides/_rels/slide2.xml.rels': strToU8(rels(`<Relationship Id="rId1" Type="${REL}/image" Target="../media/logo.png"/>`)),
    'ppt/media/chart.png': new Uint8Array([1, 2, 3]),
    'ppt/media/logo.png': new Uint8Array([4, 5, 6]),
    'ppt/media/formula.emf': new Uint8Array([7, 8, 9]),
  });
}

describe('resolvePartPath', () => {
  it('resolves relative and absolute relationship targets', () => {
    expect(resolvePartPath('ppt/slides/slide1.xml', '../media/a.png')).toBe('ppt/media/a.png');
    expect(resolvePartPath('ppt/presentation.xml', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
    expect(resolvePartPath('ppt/slides/slide1.xml', '/ppt/media/a.png')).toBe('ppt/media/a.png');
  });
});

describe('readPptx', () => {
  it('groups each image across slides, numbered in deck order', () => {
    const images = readPptx(deck());
    const logo = images.find(i => i.mediaPath === 'ppt/media/logo.png')!;
    expect(logo.slides).toEqual([1, 2]);
    expect(logo.pictures).toHaveLength(2);
    expect(images.find(i => i.mediaPath === 'ppt/media/chart.png')!.slides).toEqual([2]);
  });

  it('uses slide text and speaker notes as context', () => {
    const chart = readPptx(deck()).find(i => i.mediaPath === 'ppt/media/chart.png')!;
    expect(chart.context).toContain('Slide 2 text:\nKrebs cycle');
    expect(chart.context).toContain('Point at the NADH output.');
  });

  it('keeps existing alt text, skips linked pictures, and marks undrawable formats', () => {
    const images = readPptx(deck());
    expect(images.map(i => i.mediaPath)).not.toContain('https://example.edu/x.png');
    expect(images).toHaveLength(3);
    const logo = images.find(i => i.mediaPath === 'ppt/media/logo.png')!;
    expect(logo.pictures.map(p => p.existingAlt)).toContain('Existing logo alt');
    expect(images.find(i => i.mediaPath === 'ppt/media/formula.emf')!.mimeType).toBeUndefined();
  });

  it('rejects files that are not presentations', () => {
    expect(() => readPptx(new Uint8Array([1, 2, 3]))).toThrow(/not a PowerPoint/);
    expect(() => readPptx(zipSync({ 'word/document.xml': strToU8('<w/>') }))).toThrow(/not a PowerPoint/);
  });
});

describe('writePptxAltText', () => {
  it('writes alt text into every picture of a decided image and leaves the rest alone', () => {
    const output = writePptxAltText(deck(), new Map([
      ['ppt/media/chart.png', { decorative: false, altText: 'Krebs cycle diagram.', longDescription: 'Eight steps from citrate to oxaloacetate.' }],
    ]));
    const reread = readPptx(output);
    const chart = reread.find(i => i.mediaPath === 'ppt/media/chart.png')!;
    expect(chart.pictures[0].existingAlt).toBe('Krebs cycle diagram. Eight steps from citrate to oxaloacetate.');
    const logo = reread.find(i => i.mediaPath === 'ppt/media/logo.png')!;
    expect(logo.pictures.map(p => p.existingAlt).sort()).toEqual(['', 'Existing logo alt']);

    const files = unzipSync(output);
    expect(strFromU8(files['ppt/slides/slide1.xml']).startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    expect(files['ppt/media/chart.png']).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('marks decorative pictures the way PowerPoint does, and can unmark them', () => {
    const decorative = writePptxAltText(deck(), new Map([['ppt/media/logo.png', { decorative: true, altText: 'ignored', longDescription: '' }]]));
    const logo = readPptx(decorative).find(i => i.mediaPath === 'ppt/media/logo.png')!;
    expect(logo.pictures.every(p => p.existingDecorative && p.existingAlt === '')).toBe(true);

    const undone = writePptxAltText(decorative, new Map([['ppt/media/logo.png', { decorative: false, altText: 'University crest.', longDescription: '' }]]));
    const again = readPptx(undone).find(i => i.mediaPath === 'ppt/media/logo.png')!;
    expect(again.pictures.every(p => !p.existingDecorative && p.existingAlt === 'University crest.')).toBe(true);
    expect(strFromU8(unzipSync(undone)['ppt/slides/slide1.xml'])).not.toContain('extLst');
  });

  it('escapes quotes and angle brackets in alt text', () => {
    const output = writePptxAltText(deck(), new Map([['ppt/media/chart.png', { decorative: false, altText: 'x < 5 & "y" > 2', longDescription: '' }]]));
    expect(readPptx(output).find(i => i.mediaPath === 'ppt/media/chart.png')!.pictures[0].existingAlt).toBe('x < 5 & "y" > 2');
  });
});

describe('altFieldText', () => {
  it('is empty for decorative images and joins long descriptions on one line', () => {
    expect(altFieldText({ decorative: true, altText: 'a', longDescription: 'b' })).toBe('');
    expect(altFieldText({ decorative: false, altText: ' Bar chart. ', longDescription: 'Line one.\nLine two.' })).toBe('Bar chart. Line one. Line two.');
  });
});

describe('isOfficeGeneratedAlt', () => {
  it('recognises Office auto alt text in the forms real decks carry', () => {
    expect(isOfficeGeneratedAlt('A screenshot of a cell phone\n\nDescription automatically generated')).toBe(true);
    expect(isOfficeGeneratedAlt('A picture containing bird Description generated with high confidence')).toBe(true);
    expect(isOfficeGeneratedAlt('Glycolysis pathway: glucose to two pyruvate.')).toBe(false);
  });
});
