import { revokeInvite } from '../library/src/classroom';
import { ROUTES } from '../shared/api';
import { classroomCall } from './classroom';
import { pathParameter, respond } from './http';
import { withInstructor } from './identity';

const route = ROUTES.find(candidate => candidate.operationId === 'revokeInvite')!;
export const handler = withInstructor(async (event, caller) => respond(route, {
  invite: await classroomCall(deps => revokeInvite({
    profileId: pathParameter(event, 'profileId'), inviteId: pathParameter(event, 'inviteId'), ownerSub: caller.sub,
  }, deps)),
}));
