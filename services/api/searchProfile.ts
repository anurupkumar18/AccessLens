import { searchProfile } from '../library/src/routes/profiles';
import { ROUTES, SearchRequestSchema } from '../shared/api';
import { parseJsonBody, parseRequest, pathParameter, respond } from './http';
import { withInstructor } from './identity';
import { libraryCall } from './library';

const route = ROUTES.find(candidate => candidate.operationId === 'searchProfile')!;

export const handler = withInstructor(async (event, caller) => {
  const profileId = pathParameter(event, 'profileId');
  const input = parseRequest(SearchRequestSchema, parseJsonBody(event));
  const result = await libraryCall(caller, (deps, ownerSub) => searchProfile({ profileId, ownerSub, ...input }, deps));
  return respond(route, result);
});
