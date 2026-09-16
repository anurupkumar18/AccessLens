import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ArtifactManifestSchema, type ArtifactManifest } from '../../apps/extension/src/shared/contracts';

export interface ValidatedCatalog {
  artifacts: ArtifactManifest[];
  directories: string[];
}

/** Validate one S3-shaped artifact directory before it enters the catalog. */
export function validateArtifactDirectory(directory: string): ArtifactManifest {
  const manifestPath = join(directory, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`manifest.json is missing in ${directory}`);
  const entryPath = join(directory, 'index.html');
  if (!existsSync(entryPath)) throw new Error(`index.html is missing in ${directory}`);
  const manifestValue: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const parsed = ArtifactManifestSchema.safeParse(manifestValue);
  if (!parsed.success) {
    throw new Error(`invalid manifest in ${directory}: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  if (parsed.data.render.entry !== 'index.html') {
    throw new Error(`render.entry must match index.html in ${directory}`);
  }
  if (!/window\s*\.\s*accesslensInit\s*=/.test(readFileSync(entryPath, 'utf8'))) {
    throw new Error(`index.html does not define window.accesslensInit in ${directory}`);
  }
  return parsed.data;
}

function artifactDirectories(catalogRoot: string): string[] {
  const artifactsRoot = join(catalogRoot, 'artifacts');
  if (!existsSync(artifactsRoot)) throw new Error(`catalog artifacts directory is missing: ${artifactsRoot}`);
  const directories: string[] = [];
  for (const artifactId of readdirSync(artifactsRoot, { withFileTypes: true })) {
    if (!artifactId.isDirectory()) continue;
    const artifactRoot = join(artifactsRoot, artifactId.name);
    for (const version of readdirSync(artifactRoot, { withFileTypes: true })) {
      if (version.isDirectory()) {
        // Include directories even when manifest.json is absent so the validator
        // reports the malformed artifact instead of silently skipping it.
        directories.push(join(artifactRoot, version.name));
      }
    }
  }
  return directories.sort();
}

/** Validate every artifact directory, so newly seeded items are covered automatically. */
export function validateCatalog(catalogRoot = resolve('packages/catalog')): ValidatedCatalog {
  const directories = artifactDirectories(catalogRoot);
  const artifacts = directories.map(validateArtifactDirectory);
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.artifactId)) throw new Error(`duplicate artifact id: ${artifact.artifactId}`);
    seen.add(artifact.artifactId);
  }
  return { artifacts, directories };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(process.cwd(), 'scripts/catalog/validate.ts')) {
  try {
    const result = validateCatalog(process.argv[2] ? resolve(process.argv[2]) : resolve('packages/catalog'));
    console.log(`Validated ${result.artifacts.length} catalog artifacts.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
