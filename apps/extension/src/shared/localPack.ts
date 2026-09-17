import { fingerprintFrame, FINGERPRINT_ALGORITHM, FINGERPRINT_BITS } from '../sources/screen/fingerprint';
import type { AccessPack } from './contracts';

const localMedia = new Map<string, string>();

export function registerLocalSlide(packId: string, mediaUri: string, url: string): void {
  localMedia.set(`${packId}/${mediaUri}`, url);
}

export function localSlideUrl(pack: Pick<AccessPack, 'packId'>, mediaUri: string): string | null {
  return localMedia.get(`${pack.packId}/${mediaUri}`) ?? null;
}

export async function createLocalImagePack(file: File, title: string): Promise<AccessPack> {
  if (!file.type.startsWith('image/')) throw new Error('Local preview accepts a slide image (PNG or JPEG).');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser cannot prepare this image for local matching.');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    const packId = `local-${Date.now().toString(36)}`;
    const mediaUri = 'slides/local-slide-01.png';
    registerLocalSlide(packId, mediaUri, url);
    const fingerprint = fingerprintFrame({ width: data.width, height: data.height, data: data.data });
    return {
      schemaVersion: '1.0',
      packId,
      version: 1,
      title: title.trim() || file.name.replace(/\.[^.]+$/u, '') || 'Local slide preview',
      matching: { algorithm: FINGERPRINT_ALGORITHM, hashBits: FINGERPRINT_BITS, maxHammingDistance: 12, minMargin: 4, onNoMatch: 'source.unmatched' },
      review: { status: 'local-preview', reviewedBy: 'local-user', reviewedAt: new Date().toISOString(), externalSubjectMatterReview: false, notes: 'Local device-only preview; not published.' },
      assets: [{
        assetId: 'local-slide-01', mediaUri, fingerprint, title: title.trim() || file.name,
        readingOrder: ['whole-slide'],
        regions: [{ regionId: 'whole-slide', label: 'Whole slide', bounds: { x: 0, y: 0, width: 1, height: 1 }, shortDescription: 'Local slide preview. This description is only a placeholder for testing the spatial renderer.', plainLanguage: 'This is a local slide preview.' }],
      }],
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected image could not be read.'));
    image.src = url;
  });
}
