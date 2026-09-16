import { resolve } from 'node:path';
import { validateCatalog } from './validate';

/** The viewer lane owns this driver. Keep the catalog lane coupled to its seam, not a second browser implementation. */
export interface CatalogHarnessReport {
  artifactId: string;
  artifactVersion: number;
  passed: boolean;
  consoleErrors?: string[];
  screenshotPath?: string;
  error?: string;
}

export interface ViewerHarnessRunner {
  runArtifact(input: {
    artifactDirectory: string;
    manifestPath: string;
    screenshotPath?: string;
  }): Promise<{ passed: boolean; consoleErrors?: string[]; screenshotPath?: string; error?: string }>;
}

async function loadViewerHarness(): Promise<ViewerHarnessRunner> {
  try {
    // Deliberately dynamic: the viewer lane supplies this module in integration.
    const moduleName = '../../apps/viewer/harness/run';
    const moduleValue = await import(moduleName);
    const runner = (moduleValue as { runArtifact?: ViewerHarnessRunner['runArtifact']; default?: ViewerHarnessRunner }).runArtifact
      ? { runArtifact: (moduleValue as { runArtifact: ViewerHarnessRunner['runArtifact'] }).runArtifact! }
      : (moduleValue as { default?: ViewerHarnessRunner }).default;
    if (!runner?.runArtifact) throw new Error('apps/viewer/harness/run.ts does not export runArtifact');
    return runner;
  } catch (error) {
    throw new Error(`harness not available in this checkout: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runCatalogHarness(catalogRoot = resolve('packages/catalog')): Promise<CatalogHarnessReport[]> {
  const catalog = validateCatalog(catalogRoot);
  const runner = await loadViewerHarness();
  const report: CatalogHarnessReport[] = [];
  for (let index = 0; index < catalog.artifacts.length; index += 1) {
    const artifact = catalog.artifacts[index];
    const result = await runner.runArtifact({
      artifactDirectory: catalog.directories[index],
      manifestPath: resolve(catalog.directories[index], 'manifest.json'),
    });
    report.push({ artifactId: artifact.artifactId, artifactVersion: artifact.artifactVersion, ...result });
  }
  return report;
}

async function main(): Promise<void> {
  const reports = await runCatalogHarness(process.argv[2] ? resolve(process.argv[2]) : resolve('packages/catalog'));
  console.log(JSON.stringify({ passed: reports.every(report => report.passed), reports }, null, 2));
  if (reports.some(report => !report.passed)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(process.cwd(), 'scripts/catalog/harness.ts')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
