import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { PublishedPackSummary } from '../shared/api';
import type { JobRecord } from '../shared/jobs';

interface Deps {
  dynamodb: { send(command: QueryCommand): Promise<{ Items?: Record<string, unknown>[] }> };
  tableName: string;
  /** The CloudFront origin the published packs are served from. */
  assetBaseUrl: string;
}

/**
 * The packs an instructor can present: every job they own that reached
 * `published`, reduced to the newest version per pack id, newest first.
 * Read from the jobs table's ownerSub index, so a job never records a
 * student (charter A4) and jobs without an owner are not anyone's to list.
 */
export async function listPublishedPacks(ownerSub: string, deps: Deps): Promise<PublishedPackSummary[]> {
  const response = await deps.dynamodb.send(new QueryCommand({
    TableName: deps.tableName,
    IndexName: 'ownerSub-index',
    KeyConditionExpression: 'ownerSub = :ownerSub',
    ExpressionAttributeValues: { ':ownerSub': ownerSub },
  }));
  const latest = new Map<string, PublishedPackSummary>();
  for (const item of (response.Items ?? []) as JobRecord[]) {
    if (item.status !== 'published' || item.publishedVersion === undefined) continue;
    const current = latest.get(item.packId);
    if (current && current.version >= item.publishedVersion) continue;
    latest.set(item.packId, {
      packId: item.packId,
      title: item.title,
      version: item.publishedVersion,
      packUrl: `${deps.assetBaseUrl}/packs/${encodeURIComponent(item.packId)}/${item.publishedVersion}.json`,
      publishedAt: item.updatedAt,
    });
  }
  return [...latest.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
