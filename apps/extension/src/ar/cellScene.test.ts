import { describe, expect, it } from 'vitest';
import { CELL_HOTSPOTS, hotspotFor } from './cellScene';

describe('cell scene semantics', () => {
  it('maps the synchronized region to the correct AR hotspot', () => {
    expect(hotspotFor('mitochondrion').hotspotId).toBe('mitochondrion-hotspot');
    expect(hotspotFor(undefined, 'nucleus-hotspot').regionId).toBe('nucleus');
  });

  it('gives every hotspot a label and equivalent description', () => {
    expect(CELL_HOTSPOTS).toHaveLength(3);
    for (const hotspot of CELL_HOTSPOTS) {
      expect(hotspot.label.length).toBeGreaterThan(0);
      expect(hotspot.shortDescription.length).toBeGreaterThan(0);
    }
  });
});
