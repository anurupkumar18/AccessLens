import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { InstructorRecordSchema, type InstructorRecord } from '../shared/api';
import type { Caller } from './identity';

export interface InstructorStore {
  send(command: { input: unknown }): Promise<unknown>;
}

/**
 * The instructor's account record (D13): created the first time a verified
 * Google account calls `GET /v1/me`, touched on every later call. There is
 * no approval step for now; the record exists so the deployment has a user
 * base to attach course profiles to.
 */
export async function ensureInstructor(caller: Caller, deps: { dynamodb: InstructorStore; tableName: string; now?: () => string }): Promise<InstructorRecord> {
  const now = deps.now?.() ?? new Date().toISOString();
  const existing = await deps.dynamodb.send(new GetCommand({ TableName: deps.tableName, Key: { sub: caller.sub } })) as { Item?: unknown };
  if (existing.Item) {
    const record = InstructorRecordSchema.parse(existing.Item);
    await deps.dynamodb.send(new UpdateCommand({
      TableName: deps.tableName,
      Key: { sub: caller.sub },
      UpdateExpression: 'SET lastSeenAt = :now, email = :email' + (caller.name ? ', #name = :name' : ''),
      ...(caller.name ? { ExpressionAttributeNames: { '#name': 'name' } } : {}),
      ExpressionAttributeValues: { ':now': now, ':email': caller.email, ...(caller.name ? { ':name': caller.name } : {}) },
    }));
    return { ...record, email: caller.email, ...(caller.name ? { name: caller.name } : {}), lastSeenAt: now };
  }
  const record = InstructorRecordSchema.parse({
    sub: caller.sub,
    email: caller.email,
    ...(caller.name ? { name: caller.name } : {}),
    createdAt: now,
    lastSeenAt: now,
  });
  await deps.dynamodb.send(new PutCommand({ TableName: deps.tableName, Item: record, ConditionExpression: 'attribute_not_exists(#sub)', ExpressionAttributeNames: { '#sub': 'sub' } }));
  return record;
}
