import { publishFact } from '../library/src/classroom';
import { ROUTES } from '../shared/api';
import { classroomCall } from './classroom';
import { pathParameter, respond } from './http';
import { withInstructor } from './identity';
const route = ROUTES.find(candidate => candidate.operationId === 'publishFact')!;
export const handler = withInstructor(async (event, caller) => respond(route, { fact: await classroomCall(deps => publishFact({ profileId: pathParameter(event, 'profileId'), factId: pathParameter(event, 'factId'), ownerSub: caller.sub }, deps)) }));
