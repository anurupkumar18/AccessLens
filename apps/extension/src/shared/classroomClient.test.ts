import { describe, expect, it, vi } from 'vitest';
import { createClassroomClient } from './classroomClient';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('classroom client', () => {
  it('uses the Google ID token for student-only invite and cited-answer calls', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ membership: { profileId: 'class-1', studentSub: 'student-1', role: 'student', joinedAt: '2026-09-16T00:00:00.000Z' } }))
      .mockResolvedValueOnce(response({ status: 'answered', answer: 'Friday.', provisional: false, citations: [{ docId: 'syllabus', title: 'Syllabus', page: 2, quote: 'Due Friday.', kind: 'fact', provisional: false }] }));
    const client = createClassroomClient('https://api.test/', 'id.token', fetchImpl);
    await expect(client.redeemInvite('private-code-with-16-characters')).resolves.toMatchObject({ profileId: 'class-1' });
    await expect(client.ask('class-1', 'When is it due?')).resolves.toMatchObject({ status: 'answered', citations: [{ page: 2 }] });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://api.test/v1/invites/redeem', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer id.token' }) }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://api.test/v1/student/profiles/class-1/ask', expect.objectContaining({ body: JSON.stringify({ question: 'When is it due?' }) }));
  });
});
