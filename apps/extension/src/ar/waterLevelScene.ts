export interface WaterLevelHotspot {
  hotspotId: string;
  regionId: string;
  label: string;
  shortDescription: string;
  volume: string;
}

export const WATER_LEVEL_HOTSPOTS: WaterLevelHotspot[] = [
  {
    hotspotId: 'water-level-blood-plasma',
    regionId: 'blood-plasma',
    label: 'Blood plasma',
    shortDescription: 'The liquid part of blood that carries cells, nutrients, and dissolved substances.',
    volume: '3 liters',
  },
  {
    hotspotId: 'water-level-extracellular',
    regionId: 'extracellular-fluid',
    label: 'Fluid between cells',
    shortDescription: 'Water outside cells, including lymph and other body fluids between tissues.',
    volume: '14 liters',
  },
  {
    hotspotId: 'water-level-intracellular',
    regionId: 'intracellular-fluid',
    label: 'Fluid inside cells',
    shortDescription: 'Water held inside cells throughout the body.',
    volume: '25 liters',
  },
];

export function waterLevelHotspotFor(regionId?: string, hotspotId?: string): WaterLevelHotspot {
  return WATER_LEVEL_HOTSPOTS.find((hotspot) => hotspot.hotspotId === hotspotId)
    ?? WATER_LEVEL_HOTSPOTS.find((hotspot) => hotspot.regionId === regionId)
    ?? WATER_LEVEL_HOTSPOTS[0];
}
