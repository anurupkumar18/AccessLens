/**
 * One forced tool call to Claude on Bedrock, with backoff for throttling: a
 * 200-slide deck fires hundreds of requests, and a burst limit is the likeliest
 * failure in a shared event account.
 */
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

/** The Anthropic model the hackathon account can invoke; overridable per deploy. */
const MODEL_ID = process.env['COURSE_MEDIA_MODEL_ID'] ?? 'us.anthropic.claude-sonnet-4-6';
const client = new BedrockRuntimeClient({ maxAttempts: 3 });

const RETRYABLE = new Set(['ThrottlingException', 'ServiceUnavailableException', 'ModelNotReadyException', 'InternalServerException']);

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export async function describeWithTool(system: string, tool: ToolSpec, jpeg: Uint8Array, prompt: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await client.send(new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ image: { format: 'jpeg', source: { bytes: jpeg } } }, { text: prompt }] }],
        toolConfig: {
          tools: [{ toolSpec: { name: tool.name, description: tool.description, inputSchema: { json: tool.inputSchema as never } } }],
          toolChoice: { tool: { name: tool.name } },
        },
        inferenceConfig: { maxTokens: 2000, temperature: 0.2 },
      }));
      return response.output?.message?.content?.find(part => part.toolUse)?.toolUse?.input;
    } catch (error) {
      if (attempt >= 6 || !RETRYABLE.has((error as Error).name)) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(20_000, 1000 * 2 ** attempt) * (0.5 + Math.random())));
    }
  }
}

/** Runs `task` over `items` with at most `limit` in flight, keeping result order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
