import { z } from 'zod';
const Bounds = z.object({ x:z.number().min(0).max(1), y:z.number().min(0).max(1), width:z.number().min(0).max(1), height:z.number().min(0).max(1) });
// Optional pack blocks carried by the reviewed bio-cell-demo pack (Part 5's
// conformance report, gaps 1 and 2). All additive and optional; the frozen
// required fields are unchanged. `arScene` binds regions to AR model nodes
// (charter A11); `matching` makes the recognition threshold reviewed content.
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const ArCamera = z.object({ position: Vec3, target: Vec3, fov: z.number().positive() }).strict();
const ArHotspot = z.object({
  hotspotId: z.string().min(1), regionId: z.string().min(1), nodeName: z.string().min(1), label: z.string().min(1),
  cameraTarget: z.string().min(1).optional(), highlight: z.string().min(1).optional(),
}).strict();
const ArScene = z.object({ modelUri: z.string().min(1), defaultCamera: z.string().min(1), hotspots: z.array(ArHotspot) }).strict();
const Matching = z.object({
  algorithm: z.string().min(1), hashBits: z.number().int().positive(),
  maxHammingDistance: z.number().int().nonnegative(), minMargin: z.number().int().nonnegative(),
  onNoMatch: z.literal('source.unmatched'),
}).strict();
const Review = z.object({
  status: z.string().min(1), reviewedBy: z.string().min(1), reviewedAt: z.string().min(1),
  externalSubjectMatterReview: z.boolean(), notes: z.string().optional(),
}).strict();
// Part 6 (authoring pipeline, docs/VISUALIZATION_SYSTEM.md §4, §5, §9.5) adds
// three additive optional fields and one new standalone contract. Relay thread
// T-31. `arScene` is untouched and the authoring pipeline never writes it;
// `LiveEventSchema` gains nothing.

// A published visualization the Visualize mode loads for this slide. It names
// an artifact by id and version -- never inline code. The extension only ever
// passes these identifiers to the viewer, which fetches and runs the artifact
// inside its opaque-origin sandbox (spec §2, §6).
const Visualization = z.object({
  artifactId: z.string().min(1),
  artifactVersion: z.number().int().positive(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(1000).optional(),
  // regionId -> a name the artifact understands, so region.changed can drive
  // viz.highlight without the artifact knowing our region vocabulary.
  regionMap: z.record(z.string(), z.string()).optional(),
}).strict();

// A citation into the instructor's own course library (spec §9.5). `quote` is
// capped at 300 characters and is only ever emitted after the pipeline has
// verified it is a verbatim substring of an excerpt the model was given, so a
// student can check every citation they are shown.
export const PACK_REFERENCE_QUOTE_MAX = 300;
const Reference = z.object({
  docId: z.string().min(1),
  title: z.string().min(1),
  page: z.number().int().positive(),
  quote: z.string().min(1).max(PACK_REFERENCE_QUOTE_MAX),
}).strict();

const Region = z.object({ regionId:z.string(), label:z.string().min(1).optional(), bounds:Bounds, shortDescription:z.string(), plainLanguage:z.string(), audioUri:z.string().min(1).optional() }).strict();
const Asset = z.object({
  assetId:z.string(), mediaUri:z.string().min(1).optional(), fingerprint:z.string(), title:z.string(), subtitle:z.string().optional(),
  readingOrder:z.array(z.string()), regions:z.array(Region), arScene: ArScene.optional(),
  visualization: Visualization.optional(), references: z.array(Reference).optional(),
}).strict();
export const AccessPackSchema = z.object({
  schemaVersion:z.literal('1.0'), packId:z.string().min(1), version:z.number().int().positive(), title:z.string().min(1),
  review: Review.optional(), matching: Matching.optional(), arCameras: z.record(z.string(), ArCamera).optional(),
  reservedReadingOrderIds: z.array(z.string().min(1)).optional(),
  assets:z.array(Asset).min(1),
}).strict();
const LiveEventBase = { schemaVersion:z.literal('1.0'), sessionId:z.string().min(1), packId:z.string().min(1), packVersion:z.number().int().positive(), sequence:z.number().int().nonnegative(), sentAt:z.string().datetime() };
const Pointer = z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)});
const ArState = z.object({hotspotId:z.string().min(1), action:z.enum(['focus','highlight','clear'])});
/** Live caption of the instructor's own speech (T-16). Text only: the audio
 *  never travels on this contract. Students see it labelled as instructor
 *  speech, never as a reviewed description. */
export const CAPTION_MAX_LENGTH = 500;
const Caption = z.object({ text:z.string().min(1).max(CAPTION_MAX_LENGTH), isFinal:z.boolean() }).strict();

// Per-type field matrix: only asset.changed and region.changed may name a
// region, and only they and caption.appended may name an asset (a caption
// names the slide it was spoken over, when there is one). Every other type --
// including source.unmatched -- is base-only, so the schema itself forbids
// inventing a match for unmatched content instead of relying on producers to
// omit the field.
export const LiveEventSchema = z.discriminatedUnion('type', [
  z.object({ ...LiveEventBase, type:z.literal('asset.changed'), assetId:z.string().min(1) }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('region.changed'), assetId:z.string().min(1), regionId:z.string().min(1), pointer:Pointer.optional(), arState:ArState.optional() }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('session.started') }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('caption.appended'), assetId:z.string().min(1).optional(), caption:Caption }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('capture.paused') }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('capture.resumed') }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('capture.stopped') }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('source.unmatched') }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('session.ended') }).strict(),
]);
export const SessionMessageSchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('create'), sessionId:z.string().min(1)}).strict(),
  z.object({kind:z.literal('join'), sessionId:z.string().min(1), role:z.enum(['instructor','student'])}).strict(),
  z.object({kind:z.literal('close'), sessionId:z.string().min(1)}).strict(),
  z.object({kind:z.literal('event'), event:LiveEventSchema}).strict(),
]);

// Signed instructor/student role capability (SYSTEM_DESIGN.md "Allowed MVP
// data"; A6). Part 1 owns the shape; Part 4 (AWS) owns issuing and signing
// the opaque `token`. Never carries identity, diagnosis, or behavioral data.
export const RoleCapabilitySchema = z.object({
  schemaVersion: z.literal('1.0'),
  sessionId: z.string().min(1),
  role: z.enum(['instructor','student']),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  token: z.string().min(1),
}).strict();

// ---------------------------------------------------------------------------
// Artifact manifest (spec §4). One interactive visualization. Retrieved
// catalog items, adapted items, and generated items are all artifacts in this
// one format, which is what makes the three sources interchangeable to every
// stage downstream of the planner.

/** Libraries the viewer preloads into the sandbox. An artifact may name no others. */
export const BLESSED_LIBRARIES = [
  'd3@7', 'three@0.186', 'cytoscape@3', 'plotly-basic@2', 'animejs@3', 'katex@0.16', 'chartjs@4',
] as const;

const ArtifactProvenance = z.discriminatedUnion('kind', [
  // A wrapped open-licensed interactive from the seeded catalog.
  z.object({
    kind: z.literal('catalog'),
    sourceUrl: z.string().min(1),
    license: z.string().min(1),
  }).strict(),
  // A catalog artifact re-parameterized for one slide. Requires its parent.
  z.object({
    kind: z.literal('adapted'),
    parentArtifactId: z.string().min(1),
    parentArtifactVersion: z.number().int().positive(),
    sourceUrl: z.string().min(1).optional(),
    license: z.string().min(1),
    generatedBy: z.string().min(1),
    jobId: z.string().min(1),
  }).strict(),
  // Written from scratch for one slide. Requires the job that produced it.
  z.object({
    kind: z.literal('generated'),
    generatedBy: z.string().min(1),
    jobId: z.string().min(1),
    license: z.string().min(1).optional(),
  }).strict(),
]);

// A JSON Schema fragment describing the instructor-settable knobs. The viewer
// validates instructor-set parameters against it before injecting them, so a
// bad review edit fails in the host page rather than inside the sandbox.
const ParameterSchemaFragment = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.record(z.string(), z.unknown())),
  required: z.array(z.string()).optional(),
}).strict();

// Charter A7: every visual has an equivalent non-visual route. The critic
// rejects an artifact that cannot describe itself or say how to drive it from
// a keyboard, which is why both fields are required rather than optional.
const ArtifactAccessibility = z.object({
  description: z.string().min(1).max(1200),
  keyboard: z.string().min(1).max(600),
  semanticOutline: z.array(z.string().min(1)).optional(),
}).strict();

export const ArtifactManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  artifactId: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, 'artifactId is lowercase kebab-case'),
  artifactVersion: z.number().int().positive(),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(600),
  subjects: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)),
  interaction: z.enum(['stepper', 'explorer', 'simulation', 'plot', 'hotspot', 'timeline', 'diagram']),
  provenance: ArtifactProvenance,
  parameters: ParameterSchemaFragment,
  defaultParameters: z.record(z.string(), z.unknown()),
  libraries: z.array(z.enum(BLESSED_LIBRARIES)),
  accessibility: ArtifactAccessibility,
  render: z.object({
    entry: z.literal('index.html'),
    minWidth: z.number().int().positive(),
    minHeight: z.number().int().positive(),
  }).strict(),
}).strict().superRefine((m, ctx) => {
  // A default the parameter schema does not declare is a knob the viewer would
  // inject and never validate, so it is a manifest error, not a render error.
  for (const key of Object.keys(m.defaultParameters)) {
    if (!(key in m.parameters.properties)) {
      ctx.addIssue({ code: 'custom', path: ['defaultParameters', key], message: `defaultParameters.${key} is not declared in parameters.properties` });
    }
  }
  for (const key of Object.keys(m.parameters.properties)) {
    if (!(key in m.defaultParameters)) {
      ctx.addIssue({ code: 'custom', path: ['defaultParameters'], message: `parameters.properties.${key} has no entry in defaultParameters` });
    }
  }
});

export type AccessPack=z.infer<typeof AccessPackSchema>; export type LiveEvent=z.infer<typeof LiveEventSchema>; export type SessionMessage=z.infer<typeof SessionMessageSchema>; export type RoleCapability=z.infer<typeof RoleCapabilitySchema>; export type ArtifactManifest=z.infer<typeof ArtifactManifestSchema>; export type PackVisualization=NonNullable<z.infer<typeof Asset>['visualization']>; export type PackReference=z.infer<typeof Reference>;

// SessionClient freezes the shape from PARALLEL_WORKSTREAMS.md's contract
// freeze: create, join, send, subscribe, and close. Part 4 replaces
// InMemorySessionClient with a real WebSocket-backed implementation behind
// this same interface; Parts 2 and 3 only ever depend on the interface.
export interface SessionClient {
  create(sessionId: string): Promise<RoleCapability>;
  join(sessionId: string): Promise<RoleCapability>;
  send(event: LiveEvent): void;
  subscribe(listener: (event: LiveEvent) => void): () => void;
  close(): void;
}

export class InMemorySessionClient implements SessionClient {
  private listeners = new Set<(e: LiveEvent) => void>();
  private closed = false;

  async create(sessionId: string): Promise<RoleCapability> {
    return this.issueCapability(sessionId, 'instructor');
  }

  async join(sessionId: string): Promise<RoleCapability> {
    return this.issueCapability(sessionId, 'student');
  }

  send(event: LiveEvent): void {
    if (this.closed) throw new Error('SessionClient is closed');
    LiveEventSchema.parse(event);
    this.listeners.forEach(l => l(event));
  }

  subscribe(listener: (e: LiveEvent) => void): () => void {
    if (this.closed) throw new Error('SessionClient is closed');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  private issueCapability(sessionId: string, role: 'instructor' | 'student'): RoleCapability {
    if (this.closed) throw new Error('SessionClient is closed');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 60 * 60 * 1000);
    return RoleCapabilitySchema.parse({
      schemaVersion: '1.0',
      sessionId,
      role,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      token: `mock-${role}-${sessionId}`,
    });
  }
}
