import {describe,it,expect} from 'vitest';
import {AccessPackSchema,LiveEventSchema} from './contracts';
import {validPack,validEvent,invalidEvent} from './fixtures';

const base = {schemaVersion:'1.0' as const,sessionId:'demo-session',packId:'bio-cell-demo',packVersion:1,sequence:1,sentAt:'2026-09-15T15:00:00Z'};

describe('AccessLens contracts',()=>{
  it('accepts valid fixtures',()=>{
    expect(AccessPackSchema.safeParse(validPack).success).toBe(true);
    expect(LiveEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it('rejects malformed event bounds',()=>expect(LiveEventSchema.safeParse(invalidEvent).success).toBe(false));

  it('rejects prohibited raw media',()=>expect(LiveEventSchema.safeParse({...validEvent,rawFrame:'x'}).success).toBe(false));

  describe('per-type field matrix', () => {
    it('accepts asset.changed with only assetId', () => {
      expect(LiveEventSchema.safeParse({...base, type:'asset.changed', assetId:'cell-slide-03'}).success).toBe(true);
    });

    it('rejects asset.changed carrying a regionId', () => {
      expect(LiveEventSchema.safeParse({...base, type:'asset.changed', assetId:'cell-slide-03', regionId:'mitochondrion'}).success).toBe(false);
    });

    it('rejects asset.changed missing assetId', () => {
      expect(LiveEventSchema.safeParse({...base, type:'asset.changed'}).success).toBe(false);
    });

    it('accepts region.changed with assetId, regionId, pointer, and arState', () => {
      expect(LiveEventSchema.safeParse({...base, type:'region.changed', assetId:'cell-slide-03', regionId:'mitochondrion', pointer:{x:.4,y:.3}, arState:{hotspotId:'mitochondrion-hotspot', action:'focus'}}).success).toBe(true);
    });

    it('rejects region.changed missing regionId', () => {
      expect(LiveEventSchema.safeParse({...base, type:'region.changed', assetId:'cell-slide-03'}).success).toBe(false);
    });

    it('rejects region.changed missing assetId', () => {
      expect(LiveEventSchema.safeParse({...base, type:'region.changed', regionId:'mitochondrion'}).success).toBe(false);
    });

    it.each(['session.started','capture.paused','capture.resumed','capture.stopped','session.ended','source.unmatched'])(
      'accepts base-only fields for %s',
      (type) => {
        expect(LiveEventSchema.safeParse({...base, type}).success).toBe(true);
      }
    );

    // T-16: caption.appended used to sit in the list above, which meant a
    // caption event could not carry a caption. It now requires one.
    it('requires a caption on caption.appended', () => {
      expect(LiveEventSchema.safeParse({...base, type:'caption.appended'}).success).toBe(false);
      expect(LiveEventSchema.safeParse({
        ...base, type:'caption.appended', caption:{text:'the mitochondrion releases energy', isFinal:true},
      }).success).toBe(true);
    });

    it('accepts an interim caption and an optional language', () => {
      expect(LiveEventSchema.safeParse({
        ...base, type:'caption.appended', caption:{text:'the mito', isFinal:false, lang:'en-US'},
      }).success).toBe(true);
    });

    it('still refuses a caption event that names an asset', () => {
      expect(LiveEventSchema.safeParse({
        ...base, type:'caption.appended', caption:{text:'x', isFinal:true}, assetId:'cell-slide-03',
      }).success).toBe(false);
    });

    it.each(['session.started','capture.paused','capture.resumed','capture.stopped','caption.appended','session.ended','source.unmatched'])(
      'rejects %s carrying an assetId',
      (type) => {
        expect(LiveEventSchema.safeParse({...base, type, assetId:'cell-slide-03'}).success).toBe(false);
      }
    );

    it('rejects source.unmatched carrying a regionId or pointer, never inventing a match', () => {
      expect(LiveEventSchema.safeParse({...base, type:'source.unmatched', regionId:'mitochondrion'}).success).toBe(false);
      expect(LiveEventSchema.safeParse({...base, type:'source.unmatched', pointer:{x:.1,y:.1}}).success).toBe(false);
    });
  });

  describe('prohibited-field denylist', () => {
    const prohibited = {rawFrame:'data:...', cameraFrame:'data:...', studentId:'s-1', studentName:'Ana', email:'a@b.edu', diagnosis:'adhd', disability:'low-vision', grade:'A', mastery:0.9, attentionScore:0.5, gazeVector:[0,0,1], emotion:'confused'};
    for (const [field, value] of Object.entries(prohibited)) {
      it(`rejects a ${field} field on a live event`, () => {
        expect(LiveEventSchema.safeParse({...validEvent, [field]:value}).success).toBe(false);
      });
    }
  });
});
