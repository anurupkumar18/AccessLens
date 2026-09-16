import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkArtifactHtml, checkArtifactManifest, type Violation } from '../../tests/evals/properties';
import { validateCatalog } from './validate';

/** The viewer lane owns this driver. Keep the catalog lane coupled to its seam, not a second browser implementation. */
export interface CatalogHarnessReport {
  artifactId: string;
  artifactVersion: number;
  passed: boolean;
  violations?: Violation[];
  consoleErrors?: string[];
  unhandledRejections?: string[];
  screenshotPath?: string;
  error?: string;
}

export interface ViewerHarnessRunner {
  runArtifact(input: {
    artifactDirectory: string;
    manifestPath: string;
    screenshotPath?: string;
  }): Promise<{
    passed: boolean;
    consoleErrors?: string[];
    unhandledRejections?: string[];
    screenshotPath?: string;
    error?: string;
  }>;
}

async function loadViewerHarness(): Promise<ViewerHarnessRunner> {
  try {
    // The viewer harness is the only runtime driver. This adapter translates
    // its `{ ok, ... }` result into the catalog report's `{ passed, ... }` seam.
    const moduleName = '../../apps/viewer/harness/run';
    const moduleValue = await import(moduleName);
    const runHarness = (moduleValue as {
      runHarness?: (options: { artifactDir: string; screenshotPath?: string; mode: 'harness' }) => Promise<{
        ok: boolean;
        consoleErrors: string[];
        unhandledRejections: string[];
        screenshotPath?: string;
      }>;
    }).runHarness;
    if (!runHarness) throw new Error('apps/viewer/harness/run.ts does not export runHarness');
    return {
      runArtifact: async ({ artifactDirectory, screenshotPath }) => {
        const result = await runHarness({ artifactDir: artifactDirectory, screenshotPath, mode: 'harness' });
        return {
          passed: result.ok,
          consoleErrors: result.consoleErrors,
          unhandledRejections: result.unhandledRejections,
          screenshotPath: result.screenshotPath,
        };
      },
    };
  } catch (error) {
    throw new Error(`harness not available in this checkout: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface CatalogHarnessFile {
  schemaVersion: '1.0';
  passed: boolean;
  reports: CatalogHarnessReport[];
}

/**
 * Run every validated artifact through the real viewer harness and the shared
 * static artifact checks. Static failures do not short-circuit the viewer run:
 * a report should identify every failing artifact in one invocation.
 */
export async function runCatalogHarness(
  catalogRoot = resolve('packages/catalog'),
  suppliedRunner?: ViewerHarnessRunner,
  reportPath?: string,
): Promise<CatalogHarnessReport[]> {
  const catalog = validateCatalog(catalogRoot);
  const runner = suppliedRunner ?? await loadViewerHarness();
  const report: CatalogHarnessReport[] = [];
  for (let index = 0; index < catalog.artifacts.length; index += 1) {
    const artifact = catalog.artifacts[index];
    const directory = catalog.directories[index];
    const html = await readFile(resolve(directory, 'index.html'), 'utf8');
    const violations = [
      ...checkArtifactManifest(artifact, directory),
      ...checkArtifactHtml(html, directory),
    ];
    let result: Awaited<ReturnType<ViewerHarnessRunner['runArtifact']>>;
    try {
      result = await runner.runArtifact({
        artifactDirectory: directory,
        manifestPath: resolve(directory, 'manifest.json'),
      });
    } catch (error) {
      result = {
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const errors = [
      ...violations.map(violation => `${violation.rule}: ${violation.detail}`),
      ...(result.error ? [result.error] : []),
    ];
    report.push({
      artifactId: artifact.artifactId,
      artifactVersion: artifact.artifactVersion,
      passed: violations.length === 0 && result.passed,
      ...(violations.length ? { violations } : {}),
      ...(result.consoleErrors?.length ? { consoleErrors: result.consoleErrors } : {}),
      ...(result.unhandledRejections?.length ? { unhandledRejections: result.unhandledRejections } : {}),
      ...(result.screenshotPath ? { screenshotPath: result.screenshotPath } : {}),
      ...(errors.length ? { error: errors.join('; ') } : {}),
    });
  }
  if (reportPath) {
    const output: CatalogHarnessFile = {
      schemaVersion: '1.0',
      passed: report.every(entry => entry.passed),
      reports: report,
    };
    await writeFile(reportPath, JSON.stringify(output, null, 2) + '\n');
  }
  return report;
}

function parseArgs(args: readonly string[]): { catalogRoot: string; reportPath: string } {
  let catalogRoot = resolve('packages/catalog');
  let reportPath = resolve('packages/catalog/harness-report.json');
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--report' || argument === '--out') {
      const value = args[++index];
      if (!value) throw new Error(`${argument} requires a path`);
      reportPath = resolve(value);
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown argument: ${argument}`);
    } else if (index === 0) {
      catalogRoot = resolve(argument);
    } else {
      throw new Error(`unexpected argument: ${argument}`);
    }
  }
  return { catalogRoot, reportPath };
}

async function main(): Promise<void> {
  const { catalogRoot, reportPath } = parseArgs(process.argv.slice(2));
  const reports = await runCatalogHarness(catalogRoot, undefined, reportPath);
  console.log(JSON.stringify({ passed: reports.every(report => report.passed), reportPath, reports }, null, 2));
  if (reports.some(report => !report.passed)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(process.cwd(), 'scripts/catalog/harness.ts')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
