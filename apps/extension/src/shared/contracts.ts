import { z } from 'zod';
const Bounds = z.object({ x:z.number().min(0).max(1), y:z.number().min(0).max(1), width:z.number().min(0).max(1), height:z.number().min(0).max(1) });
export const AccessPackSchema = z.object({ schemaVersion:z.literal('1.0'), packId:z.string().min(1), version:z.number().int().positive(), title:z.string().min(1), assets:z.array(z.object({ assetId:z.string(), fingerprint:z.string(), title:z.string(), readingOrder:z.array(z.string()), regions:z.array(z.object({ regionId:z.string(), bounds:Bounds, shortDescription:z.string(), plainLanguage:z.string() })) })).min(1) }).strict();
const LiveEventBase = { schemaVersion:z.literal('1.0'), sessionId:z.string().min(1), packId:z.string().min(1), packVersion:z.number().int().positive(), sequence:z.number().int().nonnegative(), sentAt:z.string().datetime() };
const Pointer = z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)});
const ArState = z.object({hotspotId:z.string().min(1), action:z.enum(['focus','highlight','clear'])});

// Per-type field matrix: only asset.changed and region.changed may name an
// asset/region. Every other type -- including source.unmatched -- is
// base-only, so the schema itself forbids inventing a match for unmatched
// content instead of relying on producers to omit the field.
export const LiveEventSchema = z.discriminatedUnion('type', [
  z.object({ ...LiveEventBase, type:z.literal('asset.changed'), assetId:z.string().min(1) }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('region.changed'), assetId:z.string().min(1), regionId:z.string().min(1), pointer:Pointer.optional(), arState:ArState.optional() }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('session.started') }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('caption.appended') }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('capture.paused') }).strict(),
  z.object({ ...LiveEventBase, type:z.literal('capture.resumed') }).strict(),
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

export type AccessPack=z.infer<typeof AccessPackSchema>; export type LiveEvent=z.infer<typeof LiveEventSchema>; export type SessionMessage=z.infer<typeof SessionMessageSchema>; export type RoleCapability=z.infer<typeof RoleCapabilitySchema>;

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
