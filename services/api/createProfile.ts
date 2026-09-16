import { createProfile } from '../library/src/routes/profiles';
import { CreateProfileRequestSchema, ROUTES } from '../shared/api';
import { parseJsonBody, parseRequest, respond } from './http';
import { withInstructor } from './identity';
import { libraryCall } from './library';

const route = ROUTES.find(candidate => candidate.operationId === 'createProfile')!;

export const handler = withInstructor(async (event, caller) => {
  const input = parseRequest(CreateProfileRequestSchema, parseJsonBody(event));
  const result = await libraryCall(caller, (deps, ownerSub) => createProfile({ ...input, ownerSub }, deps));
  return respond(route, result, 201);
});
