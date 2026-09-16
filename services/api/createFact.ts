import { createFact } from '../library/src/classroom';
import { CreateFactRequestSchema, ROUTES } from '../shared/api';
import { classroomCall } from './classroom';
import { parseJsonBody, parseRequest, pathParameter, respond } from './http';
import { withInstructor } from './identity';
const route = ROUTES.find(candidate => candidate.operationId === 'createFact')!;
export const handler = withInstructor(async (event, caller) => respond(route, { fact: await classroomCall(deps => createFact({ profileId: pathParameter(event, 'profileId'), ownerSub: caller.sub, ...parseRequest(CreateFactRequestSchema, parseJsonBody(event)) }, deps)) }, 201));
