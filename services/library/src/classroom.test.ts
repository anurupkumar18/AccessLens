import { describe, expect, it, vi } from 'vitest';
import { archiveProfile, askClass, createFact, createInvite, publishFact, purgeClassMetadata, redeemInvite, revokeInvite } from './classroom';
import type { ClassroomDeps } from './classroom';

function deps(enabled = true): ClassroomDeps {
  let i = 0;
  return {
    now: () => new Date('2026-09-16T18:00:00.000Z'), id: () => `id-${++i}`, token: () => 'a-secure-invite-token', enabled,
    profiles: new Map([['class-1', { profileId: 'class-1', ownerSub: 'instructor', name: 'Algorithms', subject: 'CS', level: 'UG', timeZone: 'America/Denver', archiveState: 'active', createdAt: '2026-09-16T00:00:00.000Z', vectorIndexName: 'class-1' }]]),
    invites: new Map(), memberships: new Map(), facts: new Map(),
    retrieve: vi.fn(async () => [{ chunkId: 'doc:p1', docId: 'doc', title: 'Notes', page: 1, score: .8, text: 'Dijkstra chooses the closest unsettled vertex.' }]),
    model: { answer: vi.fn(async () => ({ answer: 'It chooses the closest unsettled vertex.', sourceIds: ['doc:p1'] })) },
  };
}

describe('approval-gated class assistant', () => {
  it('redeems an unexpired owner-created invite once and never exposes a cross-class membership', async () => {
    const d = deps();
    const invite = await createInvite({ profileId: 'class-1', ownerSub: 'instructor', expiresInHours: 24, maxRedemptions: 1 }, d);
    await expect(redeemInvite({ token: invite.token, studentSub: 'student-1' }, d)).resolves.toMatchObject({ profileId: 'class-1', role: 'student' });
    await expect(redeemInvite({ token: invite.token, studentSub: 'student-2' }, d)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects a revoked invite without revealing it', async () => {
    const d = deps();
    const invite = await createInvite({ profileId: 'class-1', ownerSub: 'instructor', expiresInHours: 4, maxRedemptions: 2 }, d);
    await revokeInvite({ profileId: 'class-1', inviteId: invite.inviteId, ownerSub: 'instructor' }, d);
    await expect(redeemInvite({ token: invite.token, studentSub: 'student-1' }, d)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('purges all class-specific membership, invite, and fact records', async () => {
    const d = deps();
    const invite = await createInvite({ profileId: 'class-1', ownerSub: 'instructor', expiresInHours: 4, maxRedemptions: 2 }, d);
    await redeemInvite({ token: invite.token, studentSub: 'student-1' }, d);
    await createFact({ profileId: 'class-1', ownerSub: 'instructor', kind: 'recap', title: 'Lecture recap', body: 'We covered graph traversal.', occurredOn: '2026-09-16', timeZone: 'America/Denver', citation: { docId: 'notes', title: 'Notes', page: 1, quote: 'We covered graph traversal.' } }, d);
    await purgeClassMetadata('class-1', d);
    expect([
      ...(d.invites as Map<string, unknown>).values(),
      ...(d.memberships as Map<string, unknown>).values(),
      ...(d.facts as Map<string, unknown>).values(),
    ]).toEqual([]);
  });

  it('answers cited draft facts as provisional and gives published facts precedence', async () => {
    const d = deps();
    const invite = await createInvite({ profileId: 'class-1', ownerSub: 'instructor', expiresInHours: 24, maxRedemptions: 2 }, d);
    await redeemInvite({ token: invite.token, studentSub: 'student-1' }, d);
    const fact = await createFact({ profileId: 'class-1', ownerSub: 'instructor', kind: 'deadline', title: 'Homework 2 submission', body: 'Homework 2 is due Friday at 11:59 PM.', dueAt: '2026-09-18T23:59:00.000Z', timeZone: 'America/Denver', citation: { docId: 'syllabus', title: 'Syllabus', page: 2, quote: 'Homework 2 is due Friday at 11:59 PM.' } }, d);
    await expect(askClass({ profileId: 'class-1', studentSub: 'student-1', question: 'When is Homework 2 due?' }, d)).resolves.toMatchObject({ status: 'answered', provisional: true, citations: [{ page: 2, provisional: true }] });
    await publishFact({ profileId: 'class-1', factId: fact.factId, ownerSub: 'instructor' }, d);
    await expect(askClass({ profileId: 'class-1', studentSub: 'student-1', question: 'When is Homework 2 due?' }, d)).resolves.toMatchObject({ status: 'answered', provisional: false });
  });

  it('fails closed for a non-member, archive, disabled flag, and model-cited source mismatch', async () => {
    const d = deps();
    await expect(askClass({ profileId: 'class-1', studentSub: 'intruder', question: 'What happened?' }, d)).rejects.toMatchObject({ code: 'not-found' });
    const invite = await createInvite({ profileId: 'class-1', ownerSub: 'instructor', expiresInHours: 24, maxRedemptions: 1 }, d);
    await redeemInvite({ token: invite.token, studentSub: 'student-1' }, d);
    (d.model!.answer as ReturnType<typeof vi.fn>).mockResolvedValue({ answer: 'Nope', sourceIds: ['outside'] });
    await expect(askClass({ profileId: 'class-1', studentSub: 'student-1', question: 'How does Dijkstra work?' }, d)).resolves.toEqual({ status: 'declined', reason: 'not-supported-by-material' });
    await archiveProfile({ profileId: 'class-1', ownerSub: 'instructor' }, d);
    await expect(askClass({ profileId: 'class-1', studentSub: 'student-1', question: 'How does Dijkstra work?' }, d)).resolves.toEqual({ status: 'declined', reason: 'class-archived' });
    const disabled = deps(false);
    const second = await createInvite({ profileId: 'class-1', ownerSub: 'instructor', expiresInHours: 24, maxRedemptions: 1 }, disabled);
    await redeemInvite({ token: second.token, studentSub: 'student-2' }, disabled);
    await expect(askClass({ profileId: 'class-1', studentSub: 'student-2', question: 'How does Dijkstra work?' }, disabled)).resolves.toEqual({ status: 'declined', reason: 'course-assistant-disabled' });
  });
});
