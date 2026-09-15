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
export const SessionMessageSchema = z.discriminatedUnion('kind',[z.object({kind:z.literal('event'),event:LiveEventSchema}),z.object({kind:z.literal('join'),sessionId:z.string().min(1),role:z.enum(['instructor','student'])})]);
export type AccessPack=z.infer<typeof AccessPackSchema>; export type LiveEvent=z.infer<typeof LiveEventSchema>; export type SessionMessage=z.infer<typeof SessionMessageSchema>;
export interface SessionClient { send(event:LiveEvent):void; subscribe(listener:(event:LiveEvent)=>void):()=>void; }
export class InMemorySessionClient implements SessionClient { private listeners=new Set<(e:LiveEvent)=>void>(); send(event:LiveEvent){LiveEventSchema.parse(event); this.listeners.forEach(l=>l(event));} subscribe(listener:(e:LiveEvent)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);} }
