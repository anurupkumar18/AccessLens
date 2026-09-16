import { ensureInstructor } from './instructors';
import { ddb } from './config';
import { ApiHttpError, respond } from './http';
import { withInstructor } from './identity';
import { libraryDeps } from './library';
import { ROUTES } from '../shared/api';

const route = ROUTES.find(candidate => candidate.operationId === 'getMe')!;

/** GET /v1/me: the account record (created on first call) and the instructor's course profiles (D13). */
export const handler = withInstructor(async (_event, caller) => {
  const instructorsTable = process.env.INSTRUCTORS_TABLE ?? '';
  if (!instructorsTable) throw new ApiHttpError(500, 'configuration_error', 'The instructors table is not configured.');
  const instructor = await ensureInstructor(caller, { dynamodb: ddb, tableName: instructorsTable });
  const profiles = await libraryDeps().profiles.listByOwner(caller.sub);
  return respond(route, { instructor, profiles });
});
