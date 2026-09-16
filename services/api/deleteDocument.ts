import { deleteDocument } from '../library/src/routes/profiles';
import { ROUTES } from '../shared/api';
import { pathParameter, respond } from './http';
import { withInstructor } from './identity';
import { libraryCall } from './library';

const route = ROUTES.find(candidate => candidate.operationId === 'deleteDocument')!;

export const handler = withInstructor(async (event, caller) => {
  const profileId = pathParameter(event, 'profileId');
  const docId = pathParameter(event, 'docId');
  const result = await libraryCall(caller, (deps, ownerSub) => deleteDocument({ profileId, docId, ownerSub }, deps));
  return respond(route, result);
});
