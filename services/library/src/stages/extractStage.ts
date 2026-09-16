import type { ExtractDeps, ExtractInput, ExtractOutput } from './types';
import { extractPages as localExtractPages } from './extractPages';

export async function extractStage(
  input: ExtractInput,
  deps: ExtractDeps = { extractPages: localExtractPages },
): Promise<ExtractOutput> {
  const pages = await deps.extractPages(input.path);
  if (pages.length === 0) throw new Error('document extraction produced no pages');
  return { pages, pageCount: pages.length };
}
