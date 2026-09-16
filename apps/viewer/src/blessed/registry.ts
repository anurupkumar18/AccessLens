import { BLESSED_LIBRARIES } from '../../../extension/src/shared/contracts';

export type BlessedLibraryName = (typeof BLESSED_LIBRARIES)[number];
export type BlessedLibrary = unknown;
export type BlessedLoader = () => Promise<BlessedLibrary>;

const notBundled = (name: string): BlessedLoader => async () => {
  throw new Error(`blessed-library-not-bundled: ${name}`);
};

/**
 * The registry is intentionally lazy. A visualization only pays for the
 * library named in its reviewed manifest; adding a live library is a build-time
 * dependency change, not a runtime URL load.
 */
export const BLESSED_LOADERS: Readonly<Record<BlessedLibraryName, BlessedLoader>> = {
  'd3@7': notBundled('d3@7'),
  // Dynamic import keeps the registry lazy while still bundling Three.js into
  // a viewer-origin asset (never loading it from a remote URL).
  'three@0.186': async () => import('three'),
  'cytoscape@3': notBundled('cytoscape@3'),
  'plotly-basic@2': notBundled('plotly-basic@2'),
  'animejs@3': notBundled('animejs@3'),
  'katex@0.16': notBundled('katex@0.16'),
  'chartjs@4': notBundled('chartjs@4'),
};

export async function loadBlessedLibraries(names: readonly string[], target: Window = window): Promise<Record<string, BlessedLibrary>> {
  const loaded: Record<string, BlessedLibrary> = {};
  for (const name of names) {
    const loader = BLESSED_LOADERS[name as BlessedLibraryName];
    if (!loader) throw new Error(`blessed-library-not-bundled: ${name}`);
    loaded[name] = await loader();
  }
  // Artifacts can use this read-only registry without an import or an eval.
  Object.defineProperty(target, 'accesslensLibraries', {
    configurable: true,
    enumerable: false,
    value: Object.freeze(loaded),
    writable: false,
  });
  return loaded;
}
