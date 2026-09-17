import { redeemInvite } from '../library/src/classroom';
import { RedeemInviteRequestSchema, ROUTES } from '../shared/api';
import { classroomCall } from './classroom';
import { parseJsonBody, parseRequest, respond } from './http';
import { withGoogleUser } from './identity';
const route = ROUTES.find(candidate => candidate.operationId === 'redeemInvite')!;
export const handler = withGoogleUser(async (event, caller) => respond(route, { membership: await classroomCall(deps => redeemInvite({ ...parseRequest(RedeemInviteRequestSchema, parseJsonBody(event)), studentSub: caller.sub }, deps)) }, 201));
