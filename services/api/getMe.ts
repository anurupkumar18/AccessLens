import { ensureInstructor } from './instructors';
import { assetBaseUrl, ddb, jobsTable } from './config';
import { ApiHttpError, respond } from './http';
import { withInstructor } from './identity';
import { libraryDeps } from './library';
import { listPublishedPacks } from './publishedPacks';
import { ROUTES } from '../shared/api';

const route = ROUTES.find(candidate => candidate.operationId === 'getMe')!;

/** GET /v1/me: the account record (created on first call), the instructor's course profiles (D13) and the packs they can present. */
export const handler = withInstructor(async (_event, caller) => {
  const instructorsTable = process.env.INSTRUCTORS_TABLE ?? '';
  if (!instructorsTable || !jobsTable || !assetBaseUrl) throw new ApiHttpError(500, 'configuration_error', 'The instructors table, jobs table or asset base URL is not configured.');
  const instructor = await ensureInstructor(caller, { dynamodb: ddb, tableName: instructorsTable });
  const [profiles, packs] = await Promise.all([
    libraryDeps().profiles.listByOwner(caller.sub),
    listPublishedPacks(caller.sub, { dynamodb: ddb, tableName: jobsTable, assetBaseUrl }),
  ]);
  return respond(route, { instructor, profiles, packs });
});
