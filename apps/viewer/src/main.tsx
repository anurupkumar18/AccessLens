import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HostApp } from './host/App';
import type { ArtifactManifest } from '../../extension/src/shared/contracts';

async function harnessManifest(): Promise<ArtifactManifest | null> {
  if (new URLSearchParams(window.location.search).get('mode') !== 'harness') return null;
  const artifactId = new URLSearchParams(window.location.search).get('artifactId') || 'hnsw-search-stepper';
  const artifactVersion = new URLSearchParams(window.location.search).get('artifactVersion') || '1';
  const base = (import.meta.env.VITE_ACCESSLENS_ARTIFACT_BASE as string | undefined)?.replace(/\/+$/, '') || '';
  const response = await fetch(`${base}/artifacts/${encodeURIComponent(artifactId)}/${artifactVersion}/manifest.json`);
  if (!response.ok) throw new Error(`harness manifest request failed (${response.status})`);
  const { ArtifactManifestSchema } = await import('../../extension/src/shared/contracts');
  const parsed = ArtifactManifestSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`harness manifest validation failed: ${parsed.error.message}`);
  return parsed.data;
}

const root = createRoot(document.getElementById('root')!);
void harnessManifest().then((manifest) => {
  root.render(<StrictMode><HostApp initialManifest={manifest} /></StrictMode>);
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  root.render(<main role="alert">{message}</main>);
});
