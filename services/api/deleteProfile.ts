import { deleteProfile } from '../library/src/routes/profiles';
import { ROUTES } from '../shared/api';
import { pathParameter, respond } from './http';
import { withInstructor } from './identity';
import { libraryCall } from './library';

const route = ROUTES.find(candidate => candidate.operationId === 'deleteProfile')!;

export const handler = withInstructor(async (event, caller) => {
  const profileId = pathParameter(event, 'profileId');
  const result = await libraryCall(caller, (deps, ownerSub) => deleteProfile({ profileId, ownerSub }, deps));
  return respond(route, result);
});
