import { createInvite } from '../library/src/classroom';
import { CreateInviteRequestSchema, ROUTES } from '../shared/api';
import { classroomCall } from './classroom';
import { parseJsonBody, parseRequest, pathParameter, respond } from './http';
import { withInstructor } from './identity';
const route = ROUTES.find(candidate => candidate.operationId === 'createInvite')!;
export const handler = withInstructor(async (event, caller) => respond(route, { invite: await classroomCall(deps => createInvite({ profileId: pathParameter(event, 'profileId'), ownerSub: caller.sub, ...parseRequest(CreateInviteRequestSchema, parseJsonBody(event)) }, deps)) }, 201));
