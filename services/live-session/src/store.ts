/**
 * Temporary session and connection state in DynamoDB, with TTL (A7).
 *
 * Two tables, both TTL'd, both holding only what the relay needs to route the
 * next event:
 *
 *   sessions     sessionId -> packId, packVersion, status, lastSequence,
 *                             latestState, latestStream, stageArn, expiresAt
 *   connections  connectionId -> sessionId, role, expiresAt
 *                with a GSI on sessionId, so a broadcast is one query rather
 *                than a scan of every connection in the account.
 *
 * **DynamoDB TTL deletes asynchronously -- typically within 48 hours, not at
 * the moment the timestamp passes.** `SYSTEM_DESIGN.md` §7 already flags this,
 * and it is the single easiest way to build a relay that keeps working after a
 * session should have stopped. Every read in this file therefore treats TTL as
 * a hint and enforces expiry itself: `isLive()` is applied to whatever comes
 * back, and an expired record is reported as absent even though DynamoDB
 * happily returned it.
 *
 * What is deliberately *not* stored: no student identity, no per-connection
 * history, no event log. `latestState` is one event per session -- the last
 * `asset.changed` / `region.changed` view -- because a reconnecting student is
 * caught up with current state, never a replay (the `reconnect-latest-state`
 * fixture's first expectation). Storing a replay buffer would both violate that
 * and create the lesson record the charter forbids.
 */
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import {
  isLive,
  nowSeconds,
  SESSION_TTL_SECONDS,
  type ConnectionRecord,
  type LatestUpdate,
  type Role,
  type SessionRecord,
  type SessionStoreApi,
} from './records.js';

// Re-exported so callers can keep importing from one place.
export * from './records.js';

export interface StoreConfig {
  sessionsTable: string;
  connectionsTable: string;
  /** GSI on the connections table, partitioned by sessionId. */
  connectionsBySessionIndex: string;
  client?: DynamoDBDocumentClient;
}

export class SessionStore implements SessionStoreApi {
  private readonly doc: DynamoDBDocumentClient;

  constructor(private readonly config: StoreConfig) {
    this.doc =
      config.client ??
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  async createSession(
    sessionId: string,
    packId: string,
    packVersion: number,
    stageArn: string | undefined,
    now: Date = new Date(),
  ): Promise<SessionRecord> {
    const record: SessionRecord = {
      sessionId,
      packId,
      packVersion,
      status: 'open',
      lastSequence: 0,
      ...(stageArn ? { stageArn } : {}),
      expiresAt: nowSeconds(now) + SESSION_TTL_SECONDS,
    };
    // Idempotent create: re-issuing an instructor capability for a session that
    // already exists must not silently reset its sequence counter back to 0 and
    // reopen the door to replayed events.
    await this.doc.send(
      new PutCommand({
        TableName: this.config.sessionsTable,
        Item: record,
        ConditionExpression: 'attribute_not_exists(sessionId)',
      }),
    );
    return record;
  }

  /** Returns undefined for a session that is missing *or* past its expiry. */
  async getSession(sessionId: string, now: Date = new Date()): Promise<SessionRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.config.sessionsTable, Key: { sessionId } }),
    );
    const record = result.Item as SessionRecord | undefined;
    return isLive(record, nowSeconds(now)) ? record : undefined;
  }

  async pinSessionPack(sessionId: string, packId: string, packVersion: number): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.config.sessionsTable,
        Key: { sessionId },
        UpdateExpression: 'SET packId = :packId, packVersion = :packVersion',
        ConditionExpression: 'attribute_exists(sessionId)',
        ExpressionAttributeValues: { ':packId': packId, ':packVersion': packVersion },
      }),
    );
  }

  /**
   * Claim `sequence` for this session, atomically.
   *
   * Ordering cannot be decided by reading `lastSequence` and then writing it
   * back: two events arriving together would both read the same value and both
   * be accepted. The condition expression makes the database referee it, so a
   * non-monotonic event fails here even if it passed `checkEvent`.
   */
  async advanceSequence(
    sessionId: string,
    sequence: number,
    latest: LatestUpdate,
    now: Date = new Date(),
  ): Promise<boolean> {
    const sets = ['lastSequence = :sequence'];
    const removes: string[] = [];
    const values: Record<string, unknown> = {
      ':sequence': sequence,
      ':at': nowSeconds(now),
      ':open': 'open',
    };
    if (latest.view !== undefined) {
      sets.push('latestState = :latestState');
      values[':latestState'] = latest.view;
    }
    if (latest.stream === null) {
      removes.push('latestStream');
    } else if (latest.stream !== undefined) {
      sets.push('latestStream = :latestStream');
      values[':latestStream'] = latest.stream;
    }
    const expression = `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`;
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.config.sessionsTable,
          Key: { sessionId },
          UpdateExpression: expression,
          ConditionExpression:
            'attribute_exists(sessionId) AND lastSequence < :sequence AND #status = :open AND expiresAt > :at',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: values,
        }),
      );
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.config.sessionsTable,
        Key: { sessionId },
        UpdateExpression: 'SET #status = :closed',
        ConditionExpression: 'attribute_exists(sessionId)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':closed': 'closed' },
      }),
    );
  }

  async putConnection(
    connectionId: string,
    sessionId: string,
    role: Role,
    now: Date = new Date(),
  ): Promise<void> {
    const record: ConnectionRecord = {
      connectionId,
      sessionId,
      role,
      expiresAt: nowSeconds(now) + SESSION_TTL_SECONDS,
    };
    await this.doc.send(
      new PutCommand({ TableName: this.config.connectionsTable, Item: record }),
    );
  }

  async getConnection(
    connectionId: string,
    now: Date = new Date(),
  ): Promise<ConnectionRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.config.connectionsTable, Key: { connectionId } }),
    );
    const record = result.Item as ConnectionRecord | undefined;
    return isLive(record, nowSeconds(now)) ? record : undefined;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.config.connectionsTable, Key: { connectionId } }),
    );
  }

  /** Live connections for a session. Expired rows are filtered, not returned. */
  async connectionsForSession(
    sessionId: string,
    now: Date = new Date(),
  ): Promise<ConnectionRecord[]> {
    const at = nowSeconds(now);
    const connections: ConnectionRecord[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.config.connectionsTable,
          IndexName: this.config.connectionsBySessionIndex,
          KeyConditionExpression: 'sessionId = :sessionId',
          ExpressionAttributeValues: { ':sessionId': sessionId },
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of (page.Items ?? []) as ConnectionRecord[]) {
        if (isLive(item, at)) connections.push(item);
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return connections;
  }
}
