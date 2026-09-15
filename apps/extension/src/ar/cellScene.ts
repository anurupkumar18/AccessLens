export interface CellHotspot {
  hotspotId: string;
  regionId: string;
  label: string;
  shortDescription: string;
}

export const CELL_HOTSPOTS: CellHotspot[] = [
  {
    hotspotId: 'cell-membrane-hotspot',
    regionId: 'membrane',
    label: 'Cell membrane',
    shortDescription: 'The outer boundary controls what enters and leaves the cell.',
  },
  {
    hotspotId: 'nucleus-hotspot',
    regionId: 'nucleus',
    label: 'Nucleus',
    shortDescription: 'The nucleus stores genetic instructions used by the cell.',
  },
  {
    hotspotId: 'mitochondrion-hotspot',
    regionId: 'mitochondrion',
    label: 'Mitochondrion',
    shortDescription: 'The mitochondrion releases usable energy for the cell.',
  },
];

export function hotspotFor(regionId?: string, hotspotId?: string): CellHotspot {
  return CELL_HOTSPOTS.find((hotspot) => hotspot.hotspotId === hotspotId)
    ?? CELL_HOTSPOTS.find((hotspot) => hotspot.regionId === regionId)
    ?? CELL_HOTSPOTS[0];
}
