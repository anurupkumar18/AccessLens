import { randomBytes, randomUUID } from 'node:crypto';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { ClassFact, ClassInvite, ClassMembership } from '../shared/api';
import type { ClassAssistantModel, ClassroomDeps } from '../library/src/classroom';
import { RouteError, type RecordStore } from '../library/src/routes/types';
import { ddb } from './config';
import { ApiHttpError } from './http';
import { libraryDeps } from './library';

class DynamoStore<T extends Record<string, unknown>> implements RecordStore<T> {
  constructor(private readonly table: string, private readonly keyName: string, private readonly keyOf: (value: T) => string, private readonly profileIndex?: string) {}
  async get(key: string): Promise<T | undefined> { return (await ddb.send(new GetCommand({ TableName: this.table, Key: { [this.keyName]: key } }))).Item as T | undefined; }
  async put(value: T): Promise<void> { await ddb.send(new PutCommand({ TableName: this.table, Item: { ...value, [this.keyName]: this.keyOf(value) } })); }
  async delete(key: string): Promise<void> { await ddb.send(new DeleteCommand({ TableName: this.table, Key: { [this.keyName]: key } })); }
  async values(): Promise<T[]> { return ((await ddb.send(new ScanCommand({ TableName: this.table }))).Items ?? []) as T[]; }
  async list(profileId?: string): Promise<T[]> {
    if (!profileId || !this.profileIndex) return this.values();
    return ((await ddb.send(new QueryCommand({ TableName: this.table, IndexName: this.profileIndex, KeyConditionExpression: 'profileId = :profileId', ExpressionAttributeValues: { ':profileId': profileId } }))).Items ?? []) as T[];
  }
  voidKey(value: T): string { return this.keyOf(value); }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ApiHttpError(500, 'configuration_error', `${name} is not configured.`);
  return value;
}

async function model(): Promise<ClassAssistantModel | undefined> {
  if (process.env.COURSE_ASSISTANT_ENABLED !== 'true') return undefined;
  const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk');
  const client = new AnthropicBedrock({ awsRegion: process.env.AWS_REGION ?? 'us-east-1' });
  const modelId = process.env.COURSE_ASSISTANT_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
  return {
    async answer(input) {
      const sourceText = input.sources.map(source => `<source id="${source.id}">${source.text}</source>`).join('\n');
      const response = await client.messages.create({
        model: modelId, max_tokens: 600,
        system: 'Answer only from the supplied class sources. Never answer requests for answer keys, tests, submissions, grades, or work completion. Return JSON with answer and sourceIds. If unsupported, return null.',
        messages: [{ role: 'user', content: `Sources:\n${sourceText}\nQuestion:\n${input.question}` }],
      });
      const text = response.content.find(block => block.type === 'text');
      if (!text || text.type !== 'text') return null;
      try {
        const parsed = JSON.parse(text.text) as { answer?: unknown; sourceIds?: unknown };
        return typeof parsed.answer === 'string' && Array.isArray(parsed.sourceIds) && parsed.sourceIds.every(id => typeof id === 'string')
          ? { answer: parsed.answer, sourceIds: parsed.sourceIds as string[] } : null;
      } catch { return null; }
    },
  };
}

/** Runtime dependencies for class routes. No question or answer is logged or stored. */
export async function classroomDeps(): Promise<ClassroomDeps> {
  const library = libraryDeps();
  const [invitesTable, membershipsTable, factsTable] = [required('INVITES_TABLE'), required('MEMBERSHIPS_TABLE'), required('FACTS_TABLE')];
  return {
    now: () => new Date(), id: () => randomUUID(), token: () => randomBytes(24).toString('base64url'),
    profiles: library.profiles,
    invites: new DynamoStore<ClassInvite>(invitesTable, 'inviteId', value => value.inviteId),
    memberships: new DynamoStore<ClassMembership>(membershipsTable, 'membershipId', value => `${value.profileId}:${value.studentSub}`, 'profileId-index'),
    facts: new DynamoStore<ClassFact>(factsTable, 'factId', value => value.factId, 'profileId-index'),
    redeemMembership: async ({ invite, membership, now }) => {
      const membershipId = `${membership.profileId}:${membership.studentSub}`;
      try {
        await ddb.send(new TransactWriteCommand({
          TransactItems: [
            { ConditionCheck: { TableName: required('PROFILES_TABLE'), Key: { profileId: membership.profileId }, ConditionExpression: 'archiveState = :active', ExpressionAttributeValues: { ':active': 'active' } } },
            { Put: { TableName: membershipsTable, Item: { ...membership, membershipId }, ConditionExpression: 'attribute_not_exists(membershipId)' } },
            { Update: { TableName: invitesTable, Key: { inviteId: invite.inviteId }, UpdateExpression: 'SET redemptions = redemptions + :one', ConditionExpression: 'attribute_not_exists(revokedAt) AND expiresAt > :now AND redemptions < maxRedemptions', ExpressionAttributeValues: { ':one': 1, ':now': now.toISOString() } } },
          ],
        }));
        return membership;
      } catch (error) {
        // A same-student retry races only with itself; return the one durable
        // membership it created. Other failed conditions stay indistinguishable.
        const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
        if (name !== 'TransactionCanceledException') throw error;
        const existing = await ddb.send(new GetCommand({ TableName: membershipsTable, Key: { membershipId } }));
        return existing.Item as ClassMembership | undefined;
      }
    },
    retrieve: (profileId, query, k) => library.retrieve(profileId, query, k),
    enabled: process.env.COURSE_ASSISTANT_ENABLED === 'true', model: await model(),
  };
}

/** Translate policy-domain failures to the public HTTP error contract. */
export async function classroomCall<T>(call: (deps: ClassroomDeps) => Promise<T>): Promise<T> {
  try {
    return await call(await classroomDeps());
  } catch (error) {
    if (error instanceof RouteError) {
      const status = error.code === 'not-found' ? 404 : error.code === 'conflict' ? 409 : 400;
      throw new ApiHttpError(status, error.code.replace('-', '_'), error.message);
    }
    throw error;
  }
}
