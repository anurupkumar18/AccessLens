import { z } from 'zod';

const ReferenceSchema = z.object({
  docId: z.string().min(1),
  title: z.string().min(1),
  page: z.number().int().positive(),
  quote: z.string().min(1).max(300),
}).strict();

const ExtensionContextSchema = z.object({
  slideTitle: z.string(),
  slideDescription: z.string(),
  lessonContext: z.string(),
  references: z.array(ReferenceSchema).optional(),
}).strict();

const SandboxContextSchema = z.object({
  slideTitle: z.string(),
  slideDescription: z.string(),
  lessonContext: z.string(),
  highlightRegionId: z.string().min(1).optional(),
  references: z.array(ReferenceSchema).optional(),
}).strict();

export const ExtensionToViewerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('viz.load'),
    packId: z.string().min(1),
    packVersion: z.number().int().positive(),
    assetId: z.string().min(1),
    artifactId: z.string().min(1),
    artifactVersion: z.number().int().positive(),
    parameters: z.record(z.string(), z.unknown()),
    ctx: ExtensionContextSchema,
  }).strict(),
  z.object({ type: z.literal('viz.highlight'), regionId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('viz.freeze') }).strict(),
  z.object({ type: z.literal('viz.clear') }).strict(),
]);

export const ViewerToExtensionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('viz.ready') }).strict(),
  z.object({ type: z.literal('viz.loaded'), artifactId: z.string().min(1), artifactVersion: z.number().int().positive() }).strict(),
  z.object({
    type: z.literal('viz.error'),
    code: z.enum(['manifest', 'params', 'render', 'blocked']),
    message: z.string().min(1),
  }).strict(),
]);

/** Messages that cross the host/sandbox boundary never contain executable code. */
export const HostToSandboxSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sandbox.load'),
    artifactId: z.string().min(1),
    artifactVersion: z.number().int().positive(),
    artifactUrl: z.string().url(),
    // The host supplies only the URL and reviewed inputs. The sandbox fetches
    // and interprets the artifact; html remains an optional harness-only
    // shortcut so jsdom can inject fixture source without a network.
    html: z.string().optional(),
    libraries: z.array(z.string()).optional(),
    parameters: z.record(z.string(), z.unknown()),
    ctx: SandboxContextSchema,
  }).strict(),
  z.object({ type: z.literal('sandbox.highlight'), regionId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('sandbox.freeze') }).strict(),
  z.object({ type: z.literal('sandbox.clear') }).strict(),
]);

export const SandboxToHostSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sandbox.ready') }).strict(),
  z.object({ type: z.literal('sandbox.loaded'), artifactId: z.string().min(1), artifactVersion: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('sandbox.error'), code: z.literal('render'), message: z.string().min(1) }).strict(),
]);

export type ExtensionToViewer = z.infer<typeof ExtensionToViewerSchema>;
export type ViewerToExtension = z.infer<typeof ViewerToExtensionSchema>;
export type HostToSandbox = z.infer<typeof HostToSandboxSchema>;
export type SandboxToHost = z.infer<typeof SandboxToHostSchema>;
export type VisualizationContext = z.infer<typeof SandboxContextSchema>;

export const SANDBOX_OPAQUE_ORIGIN = 'null';

export function parseAllowedOrigins(value: string | undefined, currentOrigin = typeof window === 'undefined' ? '' : window.location.origin): string[] {
  const configured = (value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  // Keep configured origins first so the host can select the concrete parent
  // origin for viewer -> extension replies. The viewer origin is only the
  // local/top-level fallback; it does not replace an explicit allowlist.
  return [...new Set([...configured, currentOrigin, 'chrome-extension://*'].filter(Boolean))];
}

export function originFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    // URL.origin is "null" for some extension URL implementations even
    // though the serialized origin is a valid postMessage target.
    if (parsed.protocol === 'chrome-extension:') return `${parsed.protocol}//${parsed.host}`;
    return parsed.origin === 'null' ? null : parsed.origin;
  } catch {
    return null;
  }
}

export function originAllowed(origin: string, allowlist: readonly string[]): boolean {
  return allowlist.some((allowed) => {
    if (allowed === 'chrome-extension://*') return origin.startsWith('chrome-extension://');
    return origin === allowed;
  });
}
