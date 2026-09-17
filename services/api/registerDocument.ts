import { registerDocument } from '../library/src/routes/profiles';
import { RegisterDocumentRequestSchema, ROUTES } from '../shared/api';
import { parseJsonBody, parseRequest, pathParameter, respond } from './http';
import { withInstructor } from './identity';
import { libraryCall } from './library';

const route = ROUTES.find(candidate => candidate.operationId === 'registerDocument')!;

export const handler = withInstructor(async (event, caller) => {
  const profileId = pathParameter(event, 'profileId');
  const input = parseRequest(RegisterDocumentRequestSchema, parseJsonBody(event));
  const result = await libraryCall(caller, (deps, ownerSub) => registerDocument({ profileId, ownerSub, ...input }, deps));
  return respond(route, result, 202);
});
