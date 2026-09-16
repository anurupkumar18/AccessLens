import { archiveProfile } from '../library/src/classroom';
import { getProfile } from '../library/src/routes/profiles';
import { ROUTES } from '../shared/api';
import { classroomCall } from './classroom';
import { pathParameter, respond } from './http';
import { withInstructor } from './identity';
import { libraryDeps } from './library';
const route = ROUTES.find(candidate => candidate.operationId === 'archiveProfile')!;
export const handler = withInstructor(async (event, caller) => { const profileId = pathParameter(event, 'profileId'); await classroomCall(deps => archiveProfile({ profileId, ownerSub: caller.sub }, deps)); return respond(route, await getProfile({ profileId, ownerSub: caller.sub }, libraryDeps())); });
