import { z } from 'zod';
import { AuthoringApiError, authoringApiUrl } from './authoringClient';

const Membership = z.object({ profileId: z.string().min(1), studentSub: z.string().min(1), role: z.literal('student'), joinedAt: z.string().min(1) });
const Citation = z.object({ docId: z.string().min(1), title: z.string().min(1), page: z.number().int().positive(), quote: z.string().min(1).max(300), kind: z.enum(['fact', 'document']), provisional: z.boolean() });
const AskResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('answered'), answer: z.string().min(1).max(700), citations: z.array(Citation).min(1), provisional: z.boolean() }),
  z.object({ status: z.literal('declined'), reason: z.enum(['course-assistant-disabled', 'not-supported-by-material', 'class-archived', 'model-unavailable']) }),
]);

export type CourseMembership = z.infer<typeof Membership>;
export type CourseAskResult = z.infer<typeof AskResult>;

/** Student-only calls. Questions and answers are sent only for the request and are never cached here. */
export interface ClassroomClient {
  redeemInvite(token: string): Promise<CourseMembership>;
  ask(profileId: string, question: string): Promise<CourseAskResult>;
}

export function createClassroomClient(baseUrl: string, idToken: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): ClassroomClient {
  const root = baseUrl.replace(/\/+$/u, '');
  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await fetchImpl(`${root}${path}`, {
      method: 'POST', headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
      throw new AuthoringApiError(response.status, error?.code ?? 'http_error', error?.message ?? `The class service answered ${response.status}.`);
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success) throw new AuthoringApiError(502, 'invalid_response', 'The class service returned an invalid response.');
    return checked.data;
  }
  return {
    redeemInvite: token => post('/v1/invites/redeem', { token }, z.object({ membership: Membership }).transform(value => value.membership)),
    ask: (profileId, question) => post(`/v1/student/profiles/${encodeURIComponent(profileId)}/ask`, { question }, AskResult),
  };
}

/** The class assistant uses the same Google-authenticated API deployment as authoring. */
export const classroomApiUrl = authoringApiUrl;
