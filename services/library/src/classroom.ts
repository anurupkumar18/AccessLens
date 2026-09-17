/**
 * Approval-gated course assistant domain (AL-056).
 *
 * This module deliberately has no AWS imports and no logging. The HTTP adapter
 * supplies authenticated subjects and storage; tests use Maps. Questions and
 * answers are request-only values and never enter these records.
 */
import { type ClassFact, type ClassInvite, type ClassMembership, type FactCitation, type ProfileRecord } from '../../shared/api';
import type { Excerpt } from '../../shared/references';
import { RouteError, storeDelete, storeGet, storePut, storeValues, type RecordCollection } from './routes/types';

export interface ClassAssistantModel {
  answer(input: { question: string; sources: Array<{ id: string; text: string }> }): Promise<{ answer: string; sourceIds: string[] } | null>;
}

export interface ClassroomDeps {
  now(): Date;
  id(): string;
  token(): string;
  profiles: RecordCollection<ProfileRecord>;
  invites: RecordCollection<ClassInvite>;
  memberships: RecordCollection<ClassMembership>;
  facts: RecordCollection<ClassFact>;
  /** Production adapters atomically consume an invite and create membership. */
  redeemMembership?(input: { invite: ClassInvite; membership: ClassMembership; now: Date }): Promise<ClassMembership | undefined>;
  retrieve(profileId: string, query: string, k: number): Promise<Excerpt[]>;
  enabled: boolean;
  model?: ClassAssistantModel;
}

export async function createInvite(input: { profileId: string; ownerSub: string; expiresInHours: number; maxRedemptions: number }, deps: ClassroomDeps): Promise<ClassInvite> {
  requireEnabled(deps);
  await requireOwner(input.profileId, input.ownerSub, deps);
  const now = deps.now();
  const invite: ClassInvite = {
    inviteId: deps.id(), profileId: input.profileId, token: deps.token(),
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + input.expiresInHours * 3_600_000).toISOString(),
    maxRedemptions: input.maxRedemptions, redemptions: 0,
  };
  await storePut(deps.invites, invite.inviteId, invite);
  return invite;
}

export async function redeemInvite(input: { token: string; studentSub: string }, deps: ClassroomDeps): Promise<ClassMembership> {
  requireEnabled(deps);
  const invite = (await storeValues(deps.invites)).find(value => value.token === input.token);
  const now = deps.now();
  if (!invite || invite.revokedAt || new Date(invite.expiresAt) <= now || invite.redemptions >= invite.maxRedemptions) {
    throw new RouteError('not-found', 'invite not found');
  }
  const profile = await requireProfile(invite.profileId, deps);
  if (profile.archiveState === 'archived' || profile.archiveState === 'deleting') throw new RouteError('not-found', 'invite not found');
  const known = (await storeValues(deps.memberships, invite.profileId)).find(value => value.profileId === invite.profileId && value.studentSub === input.studentSub);
  if (known) return known;
  const membership: ClassMembership = { profileId: invite.profileId, studentSub: input.studentSub, role: 'student', joinedAt: now.toISOString() };
  if (deps.redeemMembership) {
    const claimed = await deps.redeemMembership({ invite, membership, now });
    if (!claimed) throw new RouteError('not-found', 'invite not found');
    return claimed;
  }
  await storePut(deps.memberships, membershipKey(membership.profileId, membership.studentSub), membership);
  await storePut(deps.invites, invite.inviteId, { ...invite, redemptions: invite.redemptions + 1 });
  return membership;
}

export async function revokeInvite(input: { profileId: string; inviteId: string; ownerSub: string }, deps: ClassroomDeps): Promise<ClassInvite> {
  await requireOwner(input.profileId, input.ownerSub, deps);
  const invite = await storeGet(deps.invites, input.inviteId);
  if (!invite || invite.profileId !== input.profileId) throw new RouteError('not-found', 'invite not found');
  const revoked = { ...invite, revokedAt: invite.revokedAt ?? deps.now().toISOString() };
  await storePut(deps.invites, invite.inviteId, revoked);
  return revoked;
}

export async function archiveProfile(input: { profileId: string; ownerSub: string }, deps: ClassroomDeps): Promise<ProfileRecord> {
  const profile = await requireOwner(input.profileId, input.ownerSub, deps);
  const archived: ProfileRecord = { ...profile, archiveState: 'archived' };
  await storePut(deps.profiles, profile.profileId, archived);
  return archived;
}

/** Removes class-only records after the library has purged its source/chunk/vector data. */
export async function purgeClassMetadata(profileId: string, deps: ClassroomDeps): Promise<void> {
  const [invites, memberships, facts] = await Promise.all([
    storeValues(deps.invites), storeValues(deps.memberships, profileId), storeValues(deps.facts, profileId),
  ]);
  await Promise.all([
    ...invites.filter(invite => invite.profileId === profileId).map(invite => storeDelete(deps.invites, invite.inviteId)),
    ...memberships.filter(membership => membership.profileId === profileId).map(membership => storeDelete(deps.memberships, membershipKey(membership.profileId, membership.studentSub))),
    ...facts.filter(fact => fact.profileId === profileId).map(fact => storeDelete(deps.facts, fact.factId)),
  ]);
}

export async function createFact(input: Omit<ClassFact, 'factId' | 'profileId' | 'createdAt' | 'publishedAt' | 'supersedesFactId' | 'status'> & { profileId: string; ownerSub: string }, deps: ClassroomDeps): Promise<ClassFact> {
  requireEnabled(deps);
  const profile = await requireOwner(input.profileId, input.ownerSub, deps);
  if (profile.archiveState !== 'active') throw new RouteError('conflict', 'archived classes cannot receive new facts');
  const fact: ClassFact = {
    factId: deps.id(), profileId: input.profileId, kind: input.kind, title: input.title, body: input.body,
    ...(input.occurredOn ? { occurredOn: input.occurredOn } : {}),
    ...(input.dueAt ? { dueAt: input.dueAt } : {}), timeZone: input.timeZone, citation: normalizeCitation(input.citation),
    status: 'draft', createdAt: deps.now().toISOString(),
  };
  await storePut(deps.facts, fact.factId, fact);
  return fact;
}

export async function publishFact(input: { profileId: string; factId: string; ownerSub: string }, deps: ClassroomDeps): Promise<ClassFact> {
  await requireOwner(input.profileId, input.ownerSub, deps);
  const fact = await storeGet(deps.facts, input.factId);
  if (!fact || fact.profileId !== input.profileId) throw new RouteError('not-found', 'fact not found');
  const published: ClassFact = { ...fact, status: 'published', publishedAt: deps.now().toISOString() };
  await storePut(deps.facts, fact.factId, published);
  return published;
}

export type StudentAnswer =
  | { status: 'answered'; answer: string; citations: Array<FactCitation & { kind: 'fact' | 'document'; provisional: boolean }>; provisional: boolean }
  | { status: 'declined'; reason: 'course-assistant-disabled' | 'not-supported-by-material' | 'class-archived' | 'model-unavailable' };

export async function askClass(input: { profileId: string; studentSub: string; question: string }, deps: ClassroomDeps): Promise<StudentAnswer> {
  const profile = await requireProfile(input.profileId, deps);
  if (profile.archiveState !== 'active') return { status: 'declined', reason: 'class-archived' };
  const membership = (await storeValues(deps.memberships, input.profileId)).find(value => value.profileId === input.profileId && value.studentSub === input.studentSub);
  if (!membership) throw new RouteError('not-found', 'class not found');
  if (!deps.enabled) return { status: 'declined', reason: 'course-assistant-disabled' };

  const facts = (await storeValues(deps.facts, input.profileId)).filter(fact => fact.profileId === input.profileId && fact.status !== 'superseded');
  const fact = bestFact(input.question, facts);
  if (fact) return factAnswer(fact);

  const excerpts = await deps.retrieve(input.profileId, input.question, 4);
  if (excerpts.length === 0 || !deps.model) return { status: 'declined', reason: 'not-supported-by-material' };
  const sources = excerpts.map(excerpt => ({ id: excerpt.chunkId, text: excerpt.text }));
  let modelResult: { answer: string; sourceIds: string[] } | null;
  try { modelResult = await deps.model.answer({ question: input.question, sources }); } catch { return { status: 'declined', reason: 'model-unavailable' }; }
  if (!modelResult?.answer || modelResult.answer.length > 700 || modelResult.sourceIds.length === 0) return { status: 'declined', reason: 'not-supported-by-material' };
  const selected = [...new Set(modelResult.sourceIds)].map(id => excerpts.find(excerpt => excerpt.chunkId === id)).filter((excerpt): excerpt is Excerpt => Boolean(excerpt));
  if (selected.length !== new Set(modelResult.sourceIds).size) return { status: 'declined', reason: 'not-supported-by-material' };
  return {
    status: 'answered', answer: modelResult.answer,
    citations: selected.map(excerpt => ({ docId: excerpt.docId, title: excerpt.title, page: excerpt.page, quote: excerpt.text.slice(0, 300), kind: 'document' as const, provisional: false })),
    provisional: false,
  };
}

async function requireProfile(profileId: string, deps: ClassroomDeps): Promise<ProfileRecord> {
  const profile = await storeGet(deps.profiles, profileId);
  if (!profile) throw new RouteError('not-found', 'class not found');
  return profile;
}

function requireEnabled(deps: ClassroomDeps): void {
  if (!deps.enabled) throw new RouteError('conflict', 'course assistant is not enabled');
}

async function requireOwner(profileId: string, ownerSub: string, deps: ClassroomDeps): Promise<ProfileRecord> {
  const profile = await requireProfile(profileId, deps);
  if (profile.ownerSub !== ownerSub) throw new RouteError('not-found', 'class not found');
  return profile;
}

function membershipKey(profileId: string, studentSub: string): string { return `${profileId}:${studentSub}`; }
function normalizeCitation(citation: FactCitation): FactCitation { return { ...citation, quote: citation.quote.slice(0, 300) }; }

function bestFact(question: string, facts: ClassFact[]): ClassFact | undefined {
  const words = new Set(question.toLowerCase().split(/[^a-z0-9]+/u).filter(word => word.length > 2));
  return facts
    .map(fact => ({ fact, score: [...words].filter(word => `${fact.title} ${fact.body} ${fact.occurredOn ?? ''} ${fact.dueAt ?? ''}`.toLowerCase().includes(word)).length }))
    .filter(result => result.score > 0)
    .sort((left, right) => (Number(right.fact.status === 'published') - Number(left.fact.status === 'published')) || right.score - left.score || right.fact.createdAt.localeCompare(left.fact.createdAt))
    .at(0)?.fact;
}

function factAnswer(fact: ClassFact): StudentAnswer {
  const provisional = fact.status !== 'published';
  return {
    status: 'answered', answer: provisional ? `Provisional: ${fact.body}` : fact.body,
    citations: [{ ...fact.citation, kind: 'fact', provisional }], provisional,
  };
}
