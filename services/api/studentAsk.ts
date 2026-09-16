import { askClass } from '../library/src/classroom';
import { ROUTES, StudentAskRequestSchema } from '../shared/api';
import { classroomCall } from './classroom';
import { parseJsonBody, parseRequest, pathParameter, respond } from './http';
import { withGoogleUser } from './identity';
const route = ROUTES.find(candidate => candidate.operationId === 'studentAsk')!;
export const handler = withGoogleUser(async (event, caller) => respond(route, await classroomCall(deps => askClass({ profileId: pathParameter(event, 'profileId'), studentSub: caller.sub, ...parseRequest(StudentAskRequestSchema, parseJsonBody(event)) }, deps))));
