import { describe, expect, it } from 'vitest';
import { slideImageUrl } from './packMedia';
import { AccessPackSchema } from './contracts';
import reviewedBioPack from '../../../../packages/access-packs/bio-cell-demo/pack.json';
import hnswDraftPack from '../../../../packs/hnsw/pack.draft.json';

describe('slideImageUrl', () => {
  it('resolves every reviewed-pack slide to a bundled image', () => {
    const pack = AccessPackSchema.parse(reviewedBioPack);
    for (const asset of pack.assets) {
      const url = slideImageUrl(pack, asset);
      expect(url, asset.assetId).toMatch(/cell-slide-\d\d.*\.png$/);
    }
  });

  it('resolves every HNSW draft slide to a bundled image', () => {
    const pack = AccessPackSchema.parse(hnswDraftPack);
    for (const asset of pack.assets) {
      expect(slideImageUrl(pack, asset), asset.assetId).toMatch(/slide-\d\d.*\.png$/);
    }
  });

  it('returns null when the asset has no media or the pack is unknown', () => {
    expect(slideImageUrl({ packId: 'bio-cell-demo' }, {})).toBeNull();
    expect(slideImageUrl({ packId: 'someone-elses-pack' }, { mediaUri: 'slides/x.png' })).toBeNull();
  });
});
