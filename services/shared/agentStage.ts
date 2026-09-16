// The one way this pipeline calls a model.
//
// Every agent stage in spec §8 is the same shape: a system prompt loaded from
// `docs/prompts/viz/<role>.md`, a **forced** tool call whose input schema is
// derived from a Zod schema, Zod validation of whatever came back, and up to
// three attempts with the validation issues appended on retry. Writing that
// once means five stages cannot each get the retry semantics subtly different,
// and it means the evaluation suite can drive a real stage through the real
// code path instead of a test-only replica.
//
// What this deliberately does not do: it does not ask the model to produce
// JSON as text and then parse it. A forced tool call with a schema is the
// difference between a stage that fails loudly and one that returns plausible
// prose on a bad day.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

/** The only Claude model invokable on this account. Spec §7, hard rule 6. */
export const AGENT_MODEL = 'us.anthropic.claude-sonnet-4-6';
export const AGENT_REGION = process.env.AWS_REGION ?? 'us-east-1';
export const MAX_ATTEMPTS = 3;

export type AgentRole = 'deck-analyst' | 'pack-author' | 'viz-planner' | 'adapter' | 'generator' | 'critic';

export const AGENT_ROLES: AgentRole[] = ['deck-analyst', 'pack-author', 'viz-planner', 'adapter', 'generator', 'critic'];

/**
 * Prompts are files, not string literals, so they are reviewable as prose and
 * diffable on their own. In a Lambda the directory is baked into the bundle at
 * build time; locally it is the repository's.
 */
export function promptDir(): string {
  return process.env.VIZ_PROMPT_DIR ?? join(process.cwd(), 'docs', 'prompts', 'viz');
}

/**
 * Extract the system prompt from a role file. The file is documentation around
 * a fenced block marked `<!-- system-prompt -->`; only the block is sent to the
 * model, so the surrounding rationale can be as long as it needs to be without
 * being paid for on every slide of every deck.
 */
export function loadSystemPrompt(role: AgentRole, dir = promptDir()): string {
  const raw = readFileSync(join(dir, `${role}.md`), 'utf8');
  const marked = /<!--\s*system-prompt\s*-->\s*```(?:\w+)?\n([\s\S]*?)```/.exec(raw);
  if (marked) return marked[1].trim();
  const firstFence = /```(?:\w+)?\n([\s\S]*?)```/.exec(raw);
  if (firstFence) return firstFence[1].trim();
  throw new Error(`${role}.md has no fenced system prompt block`);
}

export interface ImageInput { mediaType: 'image/png' | 'image/jpeg'; base64: string; }

export interface AgentCall<T extends z.ZodTypeAny> {
  role: AgentRole;
  /** Tool name; also what the prompt tells the model to call. */
  toolName: string;
  toolDescription: string;
  schema: T;
  /** Text turn handed to the model. Retrieved excerpts belong here, already formatted. */
  userText: string;
  images?: ImageInput[];
  maxTokens?: number;
  /** Stable id used in logs. Spec §13 redacts slide text and images to ids. */
  logId?: string;
}

export interface AgentResult<T> {
  value: T;
  attempts: number;
  /** Populated when an attempt failed validation; useful in the eval suite. */
  issues: string[][];
}

export class AgentStageError extends Error {
  constructor(readonly role: AgentRole, readonly attempts: number, readonly issues: string[][], message: string) {
    super(message);
    this.name = 'AgentStageError';
  }
}

/** The Bedrock surface this module needs, so tests can supply a fake. */
export interface MessagesClient {
  messages: { create(body: Record<string, unknown>): Promise<{ content: { type: string; name?: string; input?: unknown }[] }> };
}

let shared: MessagesClient | undefined;
export function bedrockClient(): MessagesClient {
  shared ??= new AnthropicBedrock({ awsRegion: AGENT_REGION }) as unknown as MessagesClient;
  return shared;
}

/**
 * Zod schema -> the tool's `input_schema`. Zod 4 renders JSON Schema natively,
 * so there is exactly one description of each stage's output and it is the one
 * the Lambda validates against. `io: 'input'` matters: a field with a default
 * is optional on the way in, and marking it required would make the model
 * repeat values it does not need to choose.
 */
export function toolInputSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Flatten Zod issues into lines short enough to append to a retry turn. */
export function issueLines(error: z.ZodError): string[] {
  return error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`);
}

/**
 * Run one agent stage. Retries carry the previous attempt's validation issues
 * forward, which is the cheapest repair signal available: a model that emitted
 * a 900-character description against a 700-character cap fixes it immediately
 * when told, and re-rolling the same prompt usually does not.
 */
export async function runAgentStage<T extends z.ZodTypeAny>(
  call: AgentCall<T>,
  client: MessagesClient = bedrockClient(),
  promptDirectory = promptDir(),
): Promise<AgentResult<z.infer<T>>> {
  const system = loadSystemPrompt(call.role, promptDirectory);
  const tool = {
    name: call.toolName,
    description: call.toolDescription,
    input_schema: toolInputSchema(call.schema),
  };

  const content: Record<string, unknown>[] = [];
  for (const image of call.images ?? []) {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
  }
  content.push({ type: 'text', text: call.userText });

  const issues: string[][] = [];
  let retryNote = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const turn = retryNote
      ? [...content, { type: 'text', text: retryNote }]
      : content;

    const response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: call.maxTokens ?? 4096,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: call.toolName },
      messages: [{ role: 'user', content: turn }],
    });

    const toolUse = response.content.find(b => b.type === 'tool_use' && b.name === call.toolName);
    if (!toolUse) {
      issues.push(['<root>: the model returned no tool call']);
      retryNote = `Your previous answer did not call ${call.toolName}. Answer by calling ${call.toolName} exactly once.`;
      continue;
    }

    const parsed = call.schema.safeParse(toolUse.input);
    if (parsed.success) return { value: parsed.data, attempts: attempt, issues };

    const lines = issueLines(parsed.error);
    issues.push(lines);
    retryNote = [
      `Your previous ${call.toolName} call failed validation. Fix exactly these problems and call the tool again:`,
      ...lines.map(l => `- ${l}`),
    ].join('\n');
  }

  throw new AgentStageError(
    call.role, MAX_ATTEMPTS, issues,
    `${call.role} produced no schema-valid output in ${MAX_ATTEMPTS} attempts${call.logId ? ` for ${call.logId}` : ''}`,
  );
}

/**
 * Spec §13: Bedrock prompts and outputs are logged with slide text and images
 * redacted to slide ids. A CloudWatch log group is not the place for a
 * professor's unpublished deck, and it is certainly not the place for a
 * textbook excerpt.
 */
export function redactedLogLine(call: { role: AgentRole; logId?: string }, outcome: string, attempts: number): string {
  return JSON.stringify({ stage: call.role, id: call.logId ?? 'unknown', outcome, attempts });
}
