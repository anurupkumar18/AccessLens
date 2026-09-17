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
  {
    hotspotId: 'cytoplasm-hotspot',
    regionId: 'cytoplasm',
    label: 'Cytoplasm',
    shortDescription: 'The fluid inside the cell holds the organelles and supports cell reactions.',
  },
  {
    hotspotId: 'nucleolus-hotspot',
    regionId: 'nucleolus',
    label: 'Nucleolus',
    shortDescription: 'The nucleolus assembles parts of ribosomes inside the nucleus.',
  },
  {
    hotspotId: 'ribosome-hotspot',
    regionId: 'ribosome',
    label: 'Ribosome',
    shortDescription: 'Ribosomes join amino acids into protein chains.',
  },
  {
    hotspotId: 'rough-er-hotspot',
    regionId: 'rough-er',
    label: 'Rough endoplasmic reticulum',
    shortDescription: 'The rough ER folds new proteins and passes them on in vesicles.',
  },
  {
    hotspotId: 'golgi-apparatus-hotspot',
    regionId: 'golgi-apparatus',
    label: 'Golgi apparatus',
    shortDescription: 'The Golgi sorts and packages proteins for delivery.',
  },
  {
    hotspotId: 'lysosome-hotspot',
    regionId: 'lysosome',
    label: 'Lysosome',
    shortDescription: 'Lysosomes break down worn-out cell parts and unwanted material.',
  },
  {
    hotspotId: 'vacuole-hotspot',
    regionId: 'vacuole',
    label: 'Vacuole',
    shortDescription: 'Vacuoles store water, nutrients, or waste inside the cell.',
  },
];

export function hotspotFor(regionId?: string, hotspotId?: string): CellHotspot {
  return CELL_HOTSPOTS.find((hotspot) => hotspot.hotspotId === hotspotId)
    ?? CELL_HOTSPOTS.find((hotspot) => hotspot.regionId === regionId)
    ?? CELL_HOTSPOTS[0];
}
