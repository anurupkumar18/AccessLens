import { fingerprintFrame, FINGERPRINT_ALGORITHM, FINGERPRINT_BITS } from '../sources/screen/fingerprint';
import { cropToAspect } from '../sources/screen/letterbox';
import { AccessPackSchema, type AccessPack } from './contracts';

const localMedia = new Map<string, string>();
const LOCAL_PACK_INDEX = 'accesslens-local-pack/latest';
const LOCAL_PACK_PREFIX = 'accesslens-local-pack/';

export function registerLocalSlide(packId: string, mediaUri: string, url: string): void {
  localMedia.set(`${packId}/${mediaUri}`, url);
}

export function localSlideUrl(pack: Pick<AccessPack, 'packId'>, mediaUri: string): string | null {
  return localMedia.get(`${pack.packId}/${mediaUri}`) ?? null;
}

/** Loads the most recent device-local preview for a second same-origin tab. */
export function loadLatestLocalPack(): AccessPack | null {
  try {
    const packId = localStorage.getItem(LOCAL_PACK_INDEX);
    if (!packId) return null;
    const stored = JSON.parse(localStorage.getItem(`${LOCAL_PACK_PREFIX}${packId}`) ?? 'null') as { pack?: unknown; mediaUrl?: string } | null;
    if (!stored?.pack || !stored.mediaUrl) return null;
    const pack = AccessPackSchema.parse(stored.pack);
    const mediaUri = pack.assets[0]?.mediaUri;
    if (mediaUri) registerLocalSlide(pack.packId, mediaUri, stored.mediaUrl);
    return pack;
  } catch {
    return null;
  }
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
    // Capture fingerprints use the same centred 16:9 crop to remove the
    // browser/image-tab letterbox. Generate the local pack with that exact
    // geometry or a clean image tab will be reported as unmatched.
    const fingerprint = fingerprintFrame(cropToAspect({ width: data.width, height: data.height, data: data.data }));
    const columns = 3;
    const rows = 2;
    const regions = Array.from({ length: columns * rows }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const bounds = { x: column / columns, y: row / rows, width: 1 / columns, height: 1 / rows };
      return {
        regionId: `auto-area-${index + 1}`,
        label: `Slide area ${index + 1}`,
        bounds,
        shortDescription: `Automatically generated spatial area ${index + 1} of ${columns * rows}.`,
        plainLanguage: `Slide area ${index + 1} of ${columns * rows}.`,
      };
    });
    const pack: AccessPack = {
      schemaVersion: '1.0',
      packId,
      version: 1,
      title: title.trim() || file.name.replace(/\.[^.]+$/u, '') || 'Local slide preview',
      // Match the reviewed demo's measured capture tolerance. The local pack
      // still has one reviewed asset, and unknown content remains unmatched
      // unless it is within this bounded perceptual distance.
      matching: { algorithm: FINGERPRINT_ALGORITHM, hashBits: FINGERPRINT_BITS, maxHammingDistance: 26, minMargin: 4, onNoMatch: 'source.unmatched' },
      review: { status: 'local-preview', reviewedBy: 'local-user', reviewedAt: new Date().toISOString(), externalSubjectMatterReview: false, notes: 'Local device-only preview; not published.' },
      assets: [{
        assetId: 'local-slide-01', mediaUri, fingerprint, title: title.trim() || file.name,
        readingOrder: regions.map(region => region.regionId),
        regions,
      }],
    };
    // BroadcastChannel carries only semantic events, so persist this explicitly
    // local demo asset for a same-origin student tab. It never reaches the API.
    try {
      const mediaUrl = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png');
      localStorage.setItem(`${LOCAL_PACK_PREFIX}${packId}`, JSON.stringify({ pack, mediaUrl }));
      localStorage.setItem(LOCAL_PACK_INDEX, packId);
      registerLocalSlide(packId, mediaUri, mediaUrl);
    } catch {
      // The instructor tab still works with its object URL if browser storage is full or unavailable.
    }
    return pack;
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
