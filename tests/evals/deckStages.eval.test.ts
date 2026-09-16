// Deck Analyst and Viz Planner against the real deck.
//
// Same contract as the Pack Author evaluation: real Bedrock, the shipped
// prompt file, the shipped Zod schema, through `runAgentStage`. Opt in with
// RUN_LLM_EVALS=1.
//
// The planner's evaluation is the more interesting one, because the property
// it checks is restraint. It is easy to build a pipeline that proposes an
// interactive for every slide and calls that success. A title slide does not
// want one, and producing one costs an instructor review time and a student
// attention -- so a planner that never says `none` has failed even though
// every one of its outputs is schema-valid.
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runAgentStage, AgentStageError } from '../../services/shared/agentStage';
import { LessonSchema, VizPlanSchema } from '../../services/shared/jobs';
import { checkLesson, checkPlanRestraint, formatViolations } from './properties';
import { EVALS_ENABLED, pngAsBase64, writeReport, renderStageTable, type CaseResult, type StageReport } from './harness';

const SLIDES = join(process.cwd(), 'packs', 'hnsw', 'slides');
const VIZ = join(process.cwd(), 'docs', 'prompts', 'viz');
const slideFiles = () => readdirSync(SLIDES).filter(f => /^slide-\d+\.png$/.test(f)).sort();

const describeIf = EVALS_ENABLED && existsSync(join(VIZ, 'deck-analyst.md')) ? describe : describe.skip;

describeIf('Deck Analyst on the real deck', () => {
  let lesson: any;
  let attempts = 0;
  let failure: string | undefined;

  beforeAll(async () => {
    const files = slideFiles();
    try {
      const result = await runAgentStage({
        role: 'deck-analyst',
        toolName: 'submit_lesson',
        toolDescription: 'Submit the deck-level lesson context.',
        schema: LessonSchema,
        userText: [
          `Deck title: "HNSW visualizations". ${files.length} slides.`,
          ``,
          `The instructor described it as: a lecture on approximate nearest neighbour search.`,
          ``,
          `Text extracted from the deck by pdftotext: (not available for this deck; the first three slide images are attached)`,
        ].join('\n'),
        images: files.slice(0, 3).map(f => ({ mediaType: 'image/png' as const, base64: pngAsBase64(join(SLIDES, f)) })),
        logId: 'hnsw-deck',
      });
      lesson = result.value;
      attempts = result.attempts;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }, 300_000);

  it('produces a lesson at all', () => {
    expect(failure).toBeUndefined();
  });

  it('names a subject specific enough to retrieve on, and concepts inside the deck', () => {
    const violations = checkLesson(lesson, slideFiles().length, 'hnsw-deck');
    expect(violations.length, `\n${formatViolations(violations)}\n`).toBe(0);
    console.log(`\ndeck-analyst (${attempts} attempt(s)): subject=${JSON.stringify(lesson.subject)} level=${JSON.stringify(lesson.level)}\n  concepts: ${lesson.concepts.map((c: any) => `${c.name} [${c.slideRange.join('-')}]`).join('; ')}\n`);
  });

  it('cites nothing, because this run supplied no course excerpts', () => {
    expect(lesson.references).toEqual([]);
  });
});

describeIf('Viz Planner restraint across the deck', () => {
  let report: StageReport;

  beforeAll(async () => {
    const lesson = {
      subject: 'Approximate nearest neighbour search',
      level: 'Graduate computer science',
      summary: 'Hierarchical navigable small world graphs: the layered structure, the greedy search, and the parameters that trade recall against latency.',
    };
    const cases: CaseResult[] = [];

    for (const file of slideFiles()) {
      const assetId = file.replace(/\.png$/, '');
      try {
        const result = await runAgentStage({
          role: 'viz-planner',
          toolName: 'submit_viz_plan',
          toolDescription: 'Submit the visualization plan for one slide.',
          schema: VizPlanSchema,
          userText: [
            `Plan the visualization for slide ${assetId} of the deck "HNSW visualizations".`,
            ``,
            `Deck context (lesson.json):`,
            JSON.stringify(lesson, null, 2),
            ``,
            `The instructor gave no hint for this slide.`,
          ].join('\n'),
          images: [{ mediaType: 'image/png', base64: pngAsBase64(join(SLIDES, file)) }],
          logId: assetId,
        });
        cases.push({
          caseId: assetId, subject: 'computer-science', heldOut: false,
          attempts: result.attempts, violations: [],
          facts: { decision: result.value.decision, concept: result.value.concept, rationale: result.value.rationale.slice(0, 120) },
        });
      } catch (error) {
        cases.push({
          caseId: assetId, subject: 'computer-science', heldOut: false,
          attempts: error instanceof AgentStageError ? error.attempts : 0,
          violations: [], facts: {},
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    report = { role: 'viz-planner', model: 'us.anthropic.claude-sonnet-4-6', startedAt: new Date().toISOString(), cases };
    writeReport(report);
    console.log(`\n${renderStageTable(report)}\n`);
    for (const c of report.cases) console.log(`  ${c.caseId}: ${c.facts.decision ?? c.error} — ${c.facts.rationale ?? ''}`);
  }, 600_000);

  it('plans every slide without exhausting its retries', () => {
    expect(report.cases.filter(c => c.error).map(c => c.caseId)).toEqual([]);
  });

  it('exercises restraint: not every slide gets an interactive', () => {
    // The failure this catches is a planner that has learned to always say yes.
    // A deck where every single slide wants a bespoke interactive is a deck the
    // planner did not actually look at.
    const decisions = report.cases.map(c => String(c.facts.decision));
    const none = decisions.filter(d => d === 'none').length;
    expect(none, `decisions: ${decisions.join(', ')}`).toBeGreaterThan(0);
  });

  it('proposes an interactive for at least half the deck, as the goal requires', () => {
    // The run's goal asks for a candidate visualization on at least half the
    // slides of a mixed-subject deck. Restraint and usefulness are both real;
    // this is the other side of the previous test.
    const decisions = report.cases.map(c => String(c.facts.decision));
    const something = decisions.filter(d => d !== 'none' && d !== 'undefined').length;
    expect(something / report.cases.length, `decisions: ${decisions.join(', ')}`).toBeGreaterThanOrEqual(0.5);
  });

  it('prefers retrieval over generation, since a proven artifact beats a fresh one', () => {
    const decisions = report.cases.map(c => String(c.facts.decision));
    const retrieveOrAdapt = decisions.filter(d => d === 'retrieve' || d === 'adapt').length;
    const generate = decisions.filter(d => d === 'generate').length;
    expect(retrieveOrAdapt, `decisions: ${decisions.join(', ')}`).toBeGreaterThanOrEqual(generate);
  });

  it('gives every non-none plan a concept the retriever can query', () => {
    for (const c of report.cases.filter(c => !c.error)) {
      const plan = { decision: c.facts.decision as any, concept: String(c.facts.concept ?? ''), rationale: String(c.facts.rationale ?? '') };
      const v = checkPlanRestraint(plan, plan.decision === 'none' ? 'none' : 'something', c.caseId);
      expect(v.filter(x => x.rule === 'plan.concept'), formatViolations(v)).toEqual([]);
    }
  });
});
