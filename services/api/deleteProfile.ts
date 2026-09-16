import { deleteProfile } from '../library/src/routes/profiles';
import { archiveProfile, purgeClassMetadata } from '../library/src/classroom';
import { ROUTES } from '../shared/api';
import { pathParameter, respond } from './http';
import { withInstructor } from './identity';
import { libraryCall } from './library';
import { classroomCall } from './classroom';

const route = ROUTES.find(candidate => candidate.operationId === 'deleteProfile')!;

export const handler = withInstructor(async (event, caller) => {
  const profileId = pathParameter(event, 'profileId');
  // Archive first so no student can race the destructive cleanup.
  await classroomCall(deps => archiveProfile({ profileId, ownerSub: caller.sub }, deps));
  const result = await libraryCall(caller, (deps, ownerSub) => deleteProfile({ profileId, ownerSub }, deps));
  await classroomCall(deps => purgeClassMetadata(profileId, deps));
  return respond(route, result);
});
