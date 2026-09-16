import {describe,it,expect,beforeAll} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './access-pack.schema.json';
import reviewedPack from '../access-packs/bio-cell-demo/pack.json';

let validate: (data: unknown) => boolean;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  validate = ajv.compile(schema);
});

const validAsset = {
  assetId: 'cell-slide-03',
  fingerprint: 'reviewed-local-match-fingerprint',
  title: 'Cell membrane and organelles',
  readingOrder: ['title', 'mitochondrion'],
  regions: [{
    regionId: 'mitochondrion',
    bounds: {x:.35, y:.22, width:.18, height:.24},
    shortDescription: 'The mitochondrion releases usable energy for the cell.',
    plainLanguage: 'This structure helps power the cell.',
  }],
};

const validPack = {schemaVersion:'1.0', packId:'bio-cell-demo', version:1, title:'Cell Structure', assets:[validAsset]};

describe('access-pack.schema.json asset/region shape', () => {
  it('accepts a fully-shaped valid pack', () => {
    expect(validate(validPack)).toBe(true);
  });

  it('rejects an asset missing regions', () => {
    const {regions, ...assetWithoutRegions} = validAsset;
    expect(validate({...validPack, assets:[assetWithoutRegions]})).toBe(false);
  });

  it('rejects a region bounds value outside 0-1', () => {
    const badAsset = {...validAsset, regions:[{...validAsset.regions[0], bounds:{x:1.5,y:.22,width:.18,height:.24}}]};
    expect(validate({...validPack, assets:[badAsset]})).toBe(false);
  });

  it('accepts the reviewed bio-cell-demo pack with its arScene, matching, review, and arCameras blocks', () => {
    expect(validate(reviewedPack)).toBe(true);
  });

  it('rejects an asset with an unknown field', () => {
    expect(validate({...validPack, assets:[{...validAsset, diagnosis:'x'}]})).toBe(false);
  });

  it('rejects a region with an unknown field', () => {
    const badAsset = {...validAsset, regions:[{...validAsset.regions[0], gazeVector:[0,0,1]}]};
    expect(validate({...validPack, assets:[badAsset]})).toBe(false);
  });
});
