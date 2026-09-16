import { describe, it, expect } from 'vitest';
import { summariseStage, countRules, renderStageTable, reportName, HELD_OUT_SUBJECTS, type StageReport, type CaseResult } from './harness';

const c = (over: Partial<CaseResult>): CaseResult => ({
  caseId: 'slide-01', subject: 'computer-science', heldOut: false, attempts: 1, violations: [], facts: {}, ...over,
});

const report = (cases: CaseResult[]): StageReport => ({
  role: 'pack-author', model: 'us.anthropic.claude-sonnet-4-6', startedAt: '2026-09-15T00:00:00.000Z', cases,
});

describe('summariseStage', () => {
  it('reports held-out subjects separately from the ones the prompt was tuned on', () => {
    const s = summariseStage(report([
      c({ caseId: 'a' }),
      c({ caseId: 'b', violations: [{ rule: 'x', where: 'b', detail: 'd' }] }),
      c({ caseId: 'c', subject: 'biology', heldOut: true }),
      c({ caseId: 'd', subject: 'biology', heldOut: true, violations: [{ rule: 'x', where: 'd', detail: 'd' }] }),
    ]));
    expect(s.cleanRate).toBe('2/4 (50%)');
    expect(s.tunedCleanRate).toBe('1/2 (50%)');
    expect(s.heldOutCleanRate).toBe('1/2 (50%)');
  });

  it('excludes errored cases from the rates rather than scoring them as failures', () => {
    const s = summariseStage(report([c({ caseId: 'a' }), c({ caseId: 'b', error: 'bedrock timeout' })]));
    expect(s.errored).toBe(1);
    expect(s.cleanRate).toBe('1/1 (100%)');
  });

  it('says n/a rather than dividing by zero when nothing was held out', () => {
    expect(summariseStage(report([c({})])).heldOutCleanRate).toBe('n/a');
  });

  it('reports the mean attempts, which is what a repair-loop regression shows up in first', () => {
    expect(summariseStage(report([c({ attempts: 1 }), c({ attempts: 3 })])).meanAttempts).toBe('2.00');
  });

  it('handles an empty run without throwing', () => {
    const s = summariseStage(report([]));
    expect(s.total).toBe(0);
    expect(s.cleanRate).toBe('n/a');
  });
});

describe('countRules', () => {
  it('counts each rule, so the report names the dominant failure rather than the first one', () => {
    expect(countRules([
      { rule: 'a', where: 'w', detail: 'd' },
      { rule: 'a', where: 'w', detail: 'd' },
      { rule: 'b', where: 'w', detail: 'd' },
    ])).toEqual({ a: 2, b: 1 });
  });
});

describe('renderStageTable', () => {
  it('lists every failing case with its rules so a number can be chased to a slide', () => {
    const table = renderStageTable(report([
      c({ caseId: 'ok-one' }),
      c({ caseId: 'bad-one', subject: 'biology', heldOut: true, violations: [{ rule: 'bounds.area', where: 'bad-one', detail: 'd' }] }),
    ]));
    expect(table).toContain('bad-one');
    expect(table).toContain('held out');
    expect(table).toContain('bounds.area');
    expect(table).not.toContain('`ok-one`');
  });
});

describe('the held-out set', () => {
  it('holds at least two subjects out, as the spec\'s anti-pattern section requires', () => {
    expect(HELD_OUT_SUBJECTS.length).toBeGreaterThanOrEqual(2);
  });
});

describe('reportName', () => {
  // Two runs of the same role over different case sets -- packs/hnsw and the
  // held-out deck -- used to collide on one filename, and the second silently
  // overwrote the first. The held-out evidence is the whole point of running
  // twice, so losing it to a filename collision loses the measurement.
  it('is the bare role when there is no variant', () => {
    expect(reportName(report([c({})]))).toBe('pack-author');
  });

  it('separates a variant run from the tuned run', () => {
    expect(reportName({ ...report([c({})]), variant: 'held-out' })).toBe('pack-author-held-out');
  });

  it('puts the variant in the rendered heading too', () => {
    expect(renderStageTable({ ...report([c({})]), variant: 'held-out' })).toContain('## pack-author-held-out');
  });
});
