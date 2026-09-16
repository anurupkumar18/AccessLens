import { reviewJob } from '../../services/publish/routes';
import { ddb, jobsTable } from './config';
import { ApiHttpError, parseJsonBody, parseRequest, pathParameter, respond, withErrors } from './http';
import { ReviewRequestSchema, ROUTES } from '../shared/api';
import type { ApiEvent } from './types';

const route = ROUTES.find(candidate => candidate.operationId === 'reviewJob')!;

export const handler = withErrors(async (event: ApiEvent) => {
  if (!jobsTable) throw new ApiHttpError(500, 'configuration_error', 'The jobs table is not configured.');
  const jobId = pathParameter(event, 'jobId');
  const request = parseRequest(ReviewRequestSchema, parseJsonBody(event));
  const result = await reviewJob({ jobId, decisions: request.decisions }, {
    dynamodb: ddb,
    // Review only reads and updates DynamoDB. The route's shared dependency
    // shape requires an ObjectStore for draft/publish callers, but it is not
    // touched on this path.
    s3: unusedStore(),
    jobsTableName: jobsTable,
  });
  return respond(route, result);
});

function unusedStore() {
  return {
    async list() { return []; },
    async read() { throw new Error('review route does not read object storage'); },
    async write() { throw new Error('review route does not write object storage'); },
    async copy() { throw new Error('review route does not copy object storage'); },
  };
}
