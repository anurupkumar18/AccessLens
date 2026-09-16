/**
 * Read the pictures out of a .pptx, and write reviewed alt text back into it.
 *
 * The instructor keeps their own deck: the output is the same file with
 * PowerPoint's own alt text field (`p:cNvPr/@descr`) filled in, so the alt text
 * travels with the slides into Canvas, a PDF export, or a projector, rather than
 * living in a side file students have to find.
 *
 * A .pptx is a zip of XML parts. Slide order comes from `presentation.xml`, not
 * from file names -- `slide10.xml` sorts before `slide2.xml`, and a reordered
 * deck keeps its original file names.
 */
import { unzipSync, zipSync, strFromU8, strToU8, type Unzipped } from 'fflate';

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  adec: 'http://schemas.microsoft.com/office/drawing/2017/decorative',
};

/** PowerPoint's "Mark as decorative" extension. */
const DECORATIVE_EXT_URI = '{C183D7F6-B498-43B3-948B-1728B52AA6E4}';

/** Formats a browser can draw, so they can be downscaled and sent for a draft. */
const DRAWABLE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

/**
 * Office's automatic alt text ("A screenshot of a cell phone. Description
 * automatically generated"). It is not the author's -- a real lecture deck had
 * twelve of these, most wrong -- so it must not count as reviewed alt text.
 */
export function isOfficeGeneratedAlt(text: string): boolean {
  return /description\s+(automatically\s+)?generated/i.test(text);
}

export interface PptxPicture {
  slidePath: string;
  /** `cNvPr/@id`, unique within its slide. */
  shapeId: string;
  name: string;
  existingAlt: string;
  existingDecorative: boolean;
}

/** One image file, wherever it appears. A logo on 30 slides is reviewed once. */
export interface PptxImage {
  mediaPath: string;
  /** Undefined for EMF, WMF, TIFF and the like: the instructor writes those by hand. */
  mimeType?: string;
  bytes: Uint8Array;
  /** 1-based slide numbers, in deck order. */
  slides: number[];
  pictures: PptxPicture[];
  /** Slide text and speaker notes from the first slide it appears on. */
  context: string;
}

export interface AltTextDecision {
  decorative: boolean;
  altText: string;
  longDescription: string;
}

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

function readPart(files: Unzipped, path: string): Document | undefined {
  const bytes = files[path];
  return bytes ? parseXml(strFromU8(bytes)) : undefined;
}

/** Resolve a relationship target against the part that owns the relationship. */
export function resolvePartPath(ownerPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ownerPath.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
}

function relsPath(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  return `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`;
}

interface Relationship { id: string; type: string; target: string; external: boolean }

function readRels(files: Unzipped, partPath: string): Relationship[] {
  const doc = readPart(files, relsPath(partPath));
  if (!doc) return [];
  return Array.from(doc.getElementsByTagNameNS(NS.rel, 'Relationship')).map(el => ({
    id: el.getAttribute('Id') ?? '',
    type: el.getAttribute('Type') ?? '',
    target: el.getAttribute('Target') ?? '',
    external: el.getAttribute('TargetMode') === 'External',
  }));
}

function textOf(doc: Document): string {
  return Array.from(doc.getElementsByTagNameNS(NS.a, 'p'))
    .map(p => Array.from(p.getElementsByTagNameNS(NS.a, 't')).map(t => t.textContent ?? '').join(''))
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

function isDecorative(cNvPr: Element): boolean {
  return Array.from(cNvPr.getElementsByTagNameNS(NS.adec, 'decorative')).some(el => el.getAttribute('val') === '1' || el.getAttribute('val') === 'true');
}

function slidePathsInOrder(files: Unzipped): string[] {
  const presentationPath = 'ppt/presentation.xml';
  const presentation = readPart(files, presentationPath);
  if (!presentation) throw new Error('This file is not a PowerPoint presentation (.pptx).');
  const rels = new Map(readRels(files, presentationPath).map(r => [r.id, r]));
  return Array.from(presentation.getElementsByTagNameNS(NS.p, 'sldId'))
    .map(el => rels.get(el.getAttributeNS(NS.r, 'id') ?? ''))
    .filter((rel): rel is Relationship => Boolean(rel))
    .map(rel => resolvePartPath(presentationPath, rel.target))
    .filter(path => files[path]);
}

export function readPptx(bytes: Uint8Array): PptxImage[] {
  let files: Unzipped;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This file is not a PowerPoint presentation (.pptx).');
  }

  const images = new Map<string, PptxImage>();
  slidePathsInOrder(files).forEach((slidePath, index) => {
    const slide = readPart(files, slidePath);
    if (!slide) return;
    const rels = readRels(files, slidePath);
    const byId = new Map(rels.map(r => [r.id, r]));
    const notesRel = rels.find(r => r.type.endsWith('/notesSlide'));
    const notes = notesRel ? readPart(files, resolvePartPath(slidePath, notesRel.target)) : undefined;
    const slideNumber = index + 1;
    const context = [`Slide ${slideNumber} text:`, textOf(slide) || '(none)', notes ? `Speaker notes:\n${textOf(notes) || '(none)'}` : '']
      .filter(Boolean)
      .join('\n');

    for (const pic of Array.from(slide.getElementsByTagNameNS(NS.p, 'pic'))) {
      const cNvPr = pic.getElementsByTagNameNS(NS.p, 'cNvPr')[0];
      const blip = pic.getElementsByTagNameNS(NS.a, 'blip')[0];
      const rel = byId.get(blip?.getAttributeNS(NS.r, 'embed') ?? '');
      // Linked (external) pictures have no bytes in the file to describe.
      if (!cNvPr || !rel || rel.external) continue;
      const mediaPath = resolvePartPath(slidePath, rel.target);
      const media = files[mediaPath];
      if (!media) continue;

      let image = images.get(mediaPath);
      if (!image) {
        const extension = mediaPath.split('.').pop()?.toLowerCase() ?? '';
        image = { mediaPath, mimeType: DRAWABLE[extension], bytes: media, slides: [], pictures: [], context };
        images.set(mediaPath, image);
      }
      if (!image.slides.includes(slideNumber)) image.slides.push(slideNumber);
      image.pictures.push({
        slidePath,
        shapeId: cNvPr.getAttribute('id') ?? '',
        name: cNvPr.getAttribute('name') ?? '',
        existingAlt: cNvPr.getAttribute('descr') ?? '',
        existingDecorative: isDecorative(cNvPr),
      });
    }
  });
  return Array.from(images.values());
}

/**
 * What goes in PowerPoint's single alt text field. Joined with a space, not a
 * newline: XML attribute normalisation turns an unescaped newline into a space
 * on the next read anyway, and `XMLSerializer` does not escape it.
 */
export function altFieldText(decision: AltTextDecision): string {
  if (decision.decorative) return '';
  return [decision.altText, decision.longDescription].map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
}

function setDecorative(doc: Document, cNvPr: Element, decorative: boolean): void {
  for (const existing of Array.from(cNvPr.getElementsByTagNameNS(NS.a, 'ext'))) {
    if (existing.getAttribute('uri') === DECORATIVE_EXT_URI) existing.parentNode?.removeChild(existing);
  }
  const extLst = cNvPr.getElementsByTagNameNS(NS.a, 'extLst')[0];
  if (!decorative) {
    if (extLst && extLst.getElementsByTagNameNS(NS.a, 'ext').length === 0) cNvPr.removeChild(extLst);
    return;
  }
  const list = extLst ?? cNvPr.appendChild(doc.createElementNS(NS.a, 'a:extLst'));
  const ext = list.appendChild(doc.createElementNS(NS.a, 'a:ext'));
  ext.setAttribute('uri', DECORATIVE_EXT_URI);
  const flag = ext.appendChild(doc.createElementNS(NS.adec, 'adec:decorative'));
  flag.setAttribute('val', '1');
}

/**
 * A copy of the deck with alt text written for every picture of every decided
 * image. Pictures of images with no decision are left exactly as they were.
 */
export function writePptxAltText(bytes: Uint8Array, decisions: ReadonlyMap<string, AltTextDecision>): Uint8Array {
  const files = unzipSync(bytes);
  const touched = new Map<string, Document>();

  for (const image of readPptx(bytes)) {
    const decision = decisions.get(image.mediaPath);
    if (!decision) continue;
    for (const picture of image.pictures) {
      let doc = touched.get(picture.slidePath);
      if (!doc) {
        doc = readPart(files, picture.slidePath)!;
        touched.set(picture.slidePath, doc);
      }
      const cNvPr = Array.from(doc.getElementsByTagNameNS(NS.p, 'cNvPr'))
        .find(el => el.getAttribute('id') === picture.shapeId && el.parentElement?.localName === 'nvPicPr');
      if (!cNvPr) continue;
      const text = altFieldText(decision);
      if (text) cNvPr.setAttribute('descr', text);
      else cNvPr.removeAttribute('descr');
      setDecorative(doc, cNvPr, decision.decorative);
    }
  }

  for (const [path, doc] of touched) {
    const original = strFromU8(files[path]);
    const declaration = original.match(/^<\?xml[^>]*\?>\s*/)?.[0] ?? '';
    const body = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
    files[path] = strToU8(declaration + body);
  }
  return zipSync(files);
}
