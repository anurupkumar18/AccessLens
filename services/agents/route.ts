import { retrieveCatalog, type CatalogMatch } from '../retriever/index';
import type { VizPlan } from '../shared/jobs';

/** Catalog scores are cosine similarities. Below this value a generated artifact is safer than adapting a weak match. */
export const CATALOG_MATCH_THRESHOLD = 0.65;
export const CATALOG_RETRIEVAL_K = 5;

export interface RouteInput {
  plan: VizPlan;
  jobId: string;
  slideId: string;
  /** Instructor edits are applied by the review/publish layer, never by a model. */
  parameters?: Record<string, unknown>;
}

export interface RouteDependencies {
  retrieveCatalog: (conceptText: string, k: number) => Promise<readonly CatalogMatch[]>;
}

export interface RouteResult {
  decision: 'none' | 'retrieve' | 'adapt' | 'generate';
  matches: CatalogMatch[];
  /** The best strong catalog candidate, supplied to the Adapter when selected. */
  parent?: CatalogMatch;
  /** Defaults for a retrieved item, or instructor overrides when supplied. */
  parameters: Record<string, unknown>;
  jobId: string;
  slideId: string;
}

const defaultDependencies: RouteDependencies = { retrieveCatalog };

function resultFor(input: RouteInput, decision: RouteResult['decision'], matches: readonly CatalogMatch[], parent?: CatalogMatch): RouteResult {
  const parameters = input.parameters
    ?? (parent ? { ...parent.manifest.defaultParameters } : {});
  return {
    decision,
    matches: [...matches],
    ...(parent ? { parent } : {}),
    parameters,
    jobId: input.jobId,
    slideId: input.slideId,
  };
}

/**
 * Stage 6: route a non-empty visualization plan through the catalog. Retrieval
 * is deliberately deterministic and is attempted before adaptation/generation;
 * an empty or weak catalog result is a normal Generator fallback, not an error.
 */
export async function routeVisualization(
  input: RouteInput,
  dependencies: Partial<RouteDependencies> = {},
): Promise<RouteResult> {
  const deps = { ...defaultDependencies, ...dependencies };
  if (input.plan.decision === 'none') return resultFor(input, 'none', []);

  // A planner decision of generate is intentionally not searched: it is the
  // explicit case where the concept has no useful standard catalog shape.
  if (input.plan.decision === 'generate') return resultFor(input, 'generate', []);

  const matches = [...await deps.retrieveCatalog(input.plan.concept, CATALOG_RETRIEVAL_K)];
  const parent = matches.find(match => Number.isFinite(match.score) && match.score >= CATALOG_MATCH_THRESHOLD);
  if (!parent) return resultFor(input, 'generate', matches);

  // retrieve keeps the proven source unchanged; adapt only changes it through
  // the Adapter stage. Both still expose the selected parent and its defaults.
  return resultFor(input, input.plan.decision, matches, parent);
}

/** Lambda-shaped entry point. */
export async function handler(input: RouteInput, dependencies: Partial<RouteDependencies> = {}): Promise<RouteResult> {
  return routeVisualization(input, dependencies);
}
