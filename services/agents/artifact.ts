import { z } from 'zod';
import { ArtifactManifestSchema, type ArtifactManifest } from '../../apps/extension/src/shared/contracts';
import { ClaimedReferencesField } from '../shared/references';

/**
 * Agent output before it is written to object storage. `indexHtml` is kept
 * explicit and required: every artifact is a complete directory, never a
 * manifest pointing at an absent or separately generated entry point.
 */
export const ArtifactDirectorySchema = z.object({
  manifest: ArtifactManifestSchema,
  indexHtml: z.string().min(1),
  assets: z.record(z.string().min(1), z.string()).default({}),
  references: ClaimedReferencesField,
}).strict();
export type ArtifactDirectory = z.infer<typeof ArtifactDirectorySchema>;

export interface ArtifactSource {
  manifest: ArtifactManifest;
  indexHtml: string;
  /** Relative path -> text/base64 payload. The Adapter sees only this parent source. */
  assets?: Readonly<Record<string, string>>;
}

export interface ArtifactAgentResult {
  artifact: ArtifactDirectory;
  /** References after deterministic verification against the excerpts supplied to the agent. */
  verifiedReferences: import('../shared/references').VerifiedReference[];
  attempts: number;
}

export function artifactDirectoryWithVerifiedReferences(
  artifact: ArtifactDirectory,
  verifiedReferences: import('../shared/references').VerifiedReference[],
): ArtifactDirectory {
  return {
    ...artifact,
    references: verifiedReferences.map(reference => ({
      docId: reference.docId,
      page: reference.page,
      quote: reference.quote,
    })),
  };
}

/** The only manifest fields an Adapter may alter without replacing provenance. */
export function manifestParametersAgree(manifest: ArtifactManifest): boolean {
  const properties = Object.keys(manifest.parameters.properties);
  const defaults = Object.keys(manifest.defaultParameters);
  return properties.length === defaults.length && properties.every(key => defaults.includes(key));
}

export function assertAdaptedProvenance(
  manifest: ArtifactManifest,
  parent: ArtifactManifest,
  jobId: string,
): void {
  if (manifest.provenance.kind !== 'adapted') throw new Error('adapted artifact must declare provenance.kind adapted');
  if (manifest.provenance.parentArtifactId !== parent.artifactId) {
    throw new Error(`adapted artifact parent id must be ${parent.artifactId}`);
  }
  if (manifest.provenance.parentArtifactVersion !== parent.artifactVersion) {
    throw new Error(`adapted artifact parent version must be ${parent.artifactVersion}`);
  }
  if (manifest.provenance.jobId !== jobId) throw new Error(`adapted artifact jobId must be ${jobId}`);
  if (manifest.provenance.license !== (parent.provenance.kind === 'catalog' || parent.provenance.kind === 'adapted'
    ? parent.provenance.license
    : parent.provenance.license ?? '')) {
    throw new Error("adapted artifact must carry the parent's license unchanged");
  }
  if (!manifestParametersAgree(manifest)) throw new Error('artifact parameters and defaultParameters do not agree');
}

export function assertGeneratedProvenance(manifest: ArtifactManifest, jobId: string): void {
  if (manifest.provenance.kind !== 'generated') throw new Error('generated artifact must declare provenance.kind generated');
  if (manifest.provenance.jobId !== jobId) throw new Error(`generated artifact jobId must be ${jobId}`);
  if (!manifestParametersAgree(manifest)) throw new Error('artifact parameters and defaultParameters do not agree');
}
