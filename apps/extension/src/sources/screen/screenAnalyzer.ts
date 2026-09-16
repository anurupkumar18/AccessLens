import type { Frame } from './captureHost';
import type { ScreenAnalysisResult } from '../../shared/contracts';

export interface ScreenAnalyzer { analyze(frame: Frame): Promise<ScreenAnalysisResult | null>; }

/** Calls the consented server-side Textract/Bedrock adapter. No frame is retained here. */
export function createBedrockScreenAnalyzer(endpoint?: string): ScreenAnalyzer | undefined {
  if (!endpoint) return undefined;
  return { async analyze(frame) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ width: frame.width, height: frame.height, rgba: Array.from(frame.data) }) });
    if (!response.ok) throw new Error(`screen analysis failed: HTTP ${response.status}`);
    return (await response.json()) as ScreenAnalysisResult;
  } };
}
