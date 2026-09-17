/**
 * DynamoDB and S3 access shared by the API, the worker, and the transcription
 * finisher. One table: a class row (`sk = CLASS`) and one row per item
 * (`sk = ITEM#<id>`), all expiring with the uploads they describe.
 */
import { createHash, randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Kind } from './formats.js';
import type { ItemStatus, Manifest } from './manifest.js';

export const TABLE = process.env['COURSE_MEDIA_TABLE'] ?? '';
export const BUCKET = process.env['COURSE_MEDIA_BUCKET'] ?? '';
/** Matches the bucket's lifecycle rule, so rows never outlive their files. */
export const RETENTION_DAYS = 90;

export const s3 = new S3Client({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

export interface ClassRecord {
  classCode: string;
  sk: 'CLASS';
  title: string;
  keyHash: string;
  createdAt: string;
  expiresAt: number;
}

export interface ItemRecord {
  classCode: string;
  sk: string;
  itemId: string;
  fileName: string;
  kind: Kind;
  status: ItemStatus;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
  /** A sentence a professor can act on; never a stack trace. */
  error?: string;
  /** Progress for long documents, e.g. pages described so far. */
  progress?: { done: number; total: number };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newClassCode(): string {
  return Array.from(randomBytes(8), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export const newItemId = () => randomBytes(8).toString('hex');
export const newInstructorKey = () => randomBytes(24).toString('base64url');
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const expiry = () => Math.floor(Date.now() / 1000) + RETENTION_DAYS * 86400;
const itemSk = (itemId: string) => `ITEM#${itemId}`;

export async function putClass(record: ClassRecord): Promise<boolean> {
  try {
    await db.send(new PutCommand({ TableName: TABLE, Item: record, ConditionExpression: 'attribute_not_exists(classCode)' }));
    return true;
  } catch (error) {
    if ((error as Error).name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

export async function getClass(classCode: string): Promise<ClassRecord | undefined> {
  const out = await db.send(new GetCommand({ TableName: TABLE, Key: { classCode, sk: 'CLASS' } }));
  return out.Item as ClassRecord | undefined;
}

export async function putItem(record: Omit<ItemRecord, 'sk'>): Promise<void> {
  await db.send(new PutCommand({ TableName: TABLE, Item: { ...record, sk: itemSk(record.itemId) } }));
}

export async function getItem(classCode: string, itemId: string): Promise<ItemRecord | undefined> {
  const out = await db.send(new GetCommand({ TableName: TABLE, Key: { classCode, sk: itemSk(itemId) } }));
  return out.Item as ItemRecord | undefined;
}

export async function listItems(classCode: string): Promise<ItemRecord[]> {
  const items: ItemRecord[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const out = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'classCode = :c AND begins_with(sk, :p)',
      ExpressionAttributeValues: { ':c': classCode, ':p': 'ITEM#' },
      ExclusiveStartKey: start,
    }));
    items.push(...((out.Items ?? []) as ItemRecord[]));
    start = out.LastEvaluatedKey;
  } while (start);
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateItem(
  classCode: string,
  itemId: string,
  patch: Partial<Pick<ItemRecord, 'status' | 'error' | 'progress' | 'kind'>>,
): Promise<void> {
  const { expression, names, values } = updateExpression({ ...patch, updatedAt: new Date().toISOString() });
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { classCode, sk: itemSk(itemId) },
    // Only rows that still exist: a professor may delete an item mid-processing.
    ConditionExpression: 'attribute_exists(classCode)',
    UpdateExpression: expression,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  })).catch(error => {
    if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
  });
}

/**
 * `undefined` means "clear this field": it becomes REMOVE, because an
 * undefined value in a SET is dropped by the marshaller and leaves the
 * expression referencing a value that no longer exists.
 */
export function updateExpression(patch: Record<string, unknown>): {
  expression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  const removes: string[] = [];
  Object.entries(patch).forEach(([key, value], i) => {
    names[`#k${i}`] = key;
    if (value === undefined) {
      removes.push(`#k${i}`);
    } else {
      values[`:v${i}`] = value;
      sets.push(`#k${i} = :v${i}`);
    }
  });
  const expression = [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : ''].filter(Boolean).join(' ');
  return { expression, names, values };
}

export async function deleteItemRecord(classCode: string, itemId: string): Promise<void> {
  await db.send(new DeleteCommand({ TableName: TABLE, Key: { classCode, sk: itemSk(itemId) } }));
}

export async function putManifest(key: string, manifest: Manifest): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(manifest), ContentType: 'application/json' }));
}

export async function readText(key: string): Promise<string> {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return (await out.Body?.transformToString()) ?? '';
}
