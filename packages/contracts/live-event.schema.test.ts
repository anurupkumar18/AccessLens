import {describe,it,expect,beforeAll} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './live-event.schema.json';

let validate: (data: unknown) => boolean;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  validate = ajv.compile(schema);
});

const base = {schemaVersion:'1.0', sessionId:'demo-session', packId:'bio-cell-demo', packVersion:1, sequence:1, sentAt:'2026-09-15T15:00:00Z'};

describe('live-event.schema.json contract matrix', () => {
  it('accepts asset.changed with only assetId', () => {
    expect(validate({...base, type:'asset.changed', assetId:'cell-slide-03'})).toBe(true);
  });

  it('rejects asset.changed carrying a regionId', () => {
    expect(validate({...base, type:'asset.changed', assetId:'cell-slide-03', regionId:'mitochondrion'})).toBe(false);
  });

  it('accepts region.changed with assetId, regionId, pointer, and arState', () => {
    expect(validate({...base, type:'region.changed', assetId:'cell-slide-03', regionId:'mitochondrion', pointer:{x:.4,y:.3}, arState:{hotspotId:'mitochondrion-hotspot', action:'focus'}})).toBe(true);
  });

  it('rejects region.changed missing regionId', () => {
    expect(validate({...base, type:'region.changed', assetId:'cell-slide-03'})).toBe(false);
  });

  it.each(['session.started','capture.paused','capture.resumed','capture.stopped','caption.appended','session.ended','source.unmatched'])(
    'accepts base-only fields for %s',
    (type) => {
      expect(validate({...base, type})).toBe(true);
    }
  );

  it.each(['session.started','capture.paused','capture.resumed','capture.stopped','caption.appended','session.ended','source.unmatched'])(
    'rejects %s carrying an assetId, never inventing a match',
    (type) => {
      expect(validate({...base, type, assetId:'cell-slide-03'})).toBe(false);
    }
  );

  it('rejects an unknown top-level field', () => {
    expect(validate({...base, type:'session.started', rawFrame:'x'})).toBe(false);
  });
});
