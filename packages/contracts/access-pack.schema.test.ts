import {describe,it,expect,beforeAll} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './access-pack.schema.json';
import reviewedPack from '../access-packs/bio-cell-demo/pack.json';
import publishedPack from '../../apps/viewer/fixtures/published-pack.json';
import { AccessPackSchema } from '../../apps/extension/src/shared/contracts';

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

// Part 6's additive fields (relay T-31). A pipeline-published pack carries a
// visualization, per-region audio, and citations into the instructor's own
// course library; a pack without any of them still validates, which is what
// keeps the checked-in bio-cell-demo pack working unchanged.
describe('Part 6 additive fields on a published pack', () => {
  it('accepts a published pack with visualization, audioUri, and references', () => {
    expect(validate(publishedPack)).toBe(true);
    expect(AccessPackSchema.safeParse(publishedPack).success).toBe(true);
  });

  it('still accepts an asset with none of them', () => {
    expect(validate(validPack)).toBe(true);
    expect(AccessPackSchema.safeParse(validPack).success).toBe(true);
  });

  it('rejects a visualization carrying inline artifact code instead of identifiers', () => {
    const asset = {...validAsset, visualization: {artifactId:'x', artifactVersion:1, parameters:{}, html:'<script>alert(1)</script>'}};
    expect(validate({...validPack, assets:[asset]})).toBe(false);
    expect(AccessPackSchema.safeParse({...validPack, assets:[asset]}).success).toBe(false);
  });

  it('rejects a visualization with no artifact version to pin', () => {
    const asset = {...validAsset, visualization: {artifactId:'x', parameters:{}}};
    expect(validate({...validPack, assets:[asset]})).toBe(false);
  });

  it('rejects a reference quote past the 300-character cap the library policy sets', () => {
    const asset = {...validAsset, references:[{docId:'d', title:'t', page:1, quote:'q'.repeat(301)}]};
    expect(validate({...validPack, assets:[asset]})).toBe(false);
    expect(AccessPackSchema.safeParse({...validPack, assets:[asset]}).success).toBe(false);
  });

  it('rejects a reference with no page, since a citation a student cannot check is worse than none', () => {
    const asset = {...validAsset, references:[{docId:'d', title:'t', quote:'q'}]};
    expect(validate({...validPack, assets:[asset]})).toBe(false);
  });

  it('rejects an empty audioUri', () => {
    const asset = {...validAsset, regions:[{...validAsset.regions[0], audioUri:''}]};
    expect(validate({...validPack, assets:[asset]})).toBe(false);
  });

  it('keeps arScene legal and untouched by the additive change', () => {
    expect(validate(reviewedPack)).toBe(true);
  });
});
