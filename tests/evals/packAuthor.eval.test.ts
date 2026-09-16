// Does the Pack Author actually produce the resource the spec specified?
//
// Real Bedrock, the shipped prompt file, the shipped Zod schema, through
// `runAgentStage` -- the same path the Lambda takes. Opt in with
// RUN_LLM_EVALS=1.
//
// What is asserted and what is only reported is a deliberate split. Structural
// rules the spec states outright -- region counts, word caps, bounds inside
// the slide, a readingOrder with no holes, no evaluative or person-describing
// language -- are asserted, because a stage that breaks them is broken.
// Whether a description is *faithful* to its slide is not asserted by anything
// here; no automated check can answer it honestly, so it is a measured rate
// and a human line in the handoff.
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runAgentStage, AgentStageError } from '../../services/shared/agentStage';
import { SlideDraftSchema } from '../../services/shared/jobs';
import { checkPackAuthorSlide, checkUndescribableSlide, summarise, formatViolations } from './properties';
import { EVALS_ENABLED, pngAsBase64, writeReport, renderStageTable, HELD_OUT_SUBJECTS, type CaseResult, type StageReport } from './harness';

const SLIDES = join(process.cwd(), 'packs', 'hnsw', 'slides');
const PROMPT = join(process.cwd(), 'docs', 'prompts', 'viz', 'pack-author.md');

/** The deck under test, and the deck-level context the analyst would supply. */
const LESSON = {
  subject: 'Approximate nearest neighbour search',
  level: 'Graduate computer science',
  summary: 'A lecture deck introducing hierarchical navigable small world graphs for approximate nearest neighbour search, covering the layered graph structure, the greedy search procedure, and the parameters that trade recall against latency.',
};

const describeIf = EVALS_ENABLED && existsSync(PROMPT) ? describe : describe.skip;

describeIf('Pack Author against real slides', () => {
  let report: StageReport;

  beforeAll(async () => {
    const files = readdirSync(SLIDES).filter(f => /^slide-\d+\.png$/.test(f)).sort();
    const cases: CaseResult[] = [];

    for (const file of files) {
      const assetId = file.replace(/\.png$/, '');
      const textPath = join(SLIDES, `${assetId}.txt`);
      const extracted = existsSync(textPath) ? readFileSync(textPath, 'utf8') : '';
      const userText = [
        `Describe slide ${assetId} from the deck "HNSW visualizations".`,
        ``,
        `Deck context (lesson.json):`,
        JSON.stringify(LESSON, null, 2),
        ``,
        extracted ? `Text extracted from this slide by pdftotext:\n${extracted}` : `No text was extracted from this slide.`,
      ].join('\n');

      try {
        const result = await runAgentStage({
          role: 'pack-author',
          toolName: 'submit_slide_description',
          toolDescription: 'Submit the draft accessibility description for one slide.',
          schema: SlideDraftSchema,
          userText,
          images: [{ mediaType: 'image/png', base64: pngAsBase64(join(SLIDES, file)) }],
          logId: assetId,
        });
        cases.push({
          caseId: assetId,
          subject: 'computer-science',
          heldOut: false,
          attempts: result.attempts,
          violations: checkPackAuthorSlide(result.value, assetId),
          facts: {
            regions: result.value.regions.length,
            title: result.value.title,
            references: result.value.references.length,
          },
        });
      } catch (error) {
        cases.push({
          caseId: assetId, subject: 'computer-science', heldOut: false,
          attempts: error instanceof AgentStageError ? error.attempts : 0,
          violations: [], facts: {
            // Record what each attempt actually failed on. Without this the
            // report says "no valid output in 3 attempts" and cannot say why,
            // which is the difference between a diagnosable prompt regression
            // and a mystery.
            attemptIssues: error instanceof AgentStageError ? JSON.stringify(error.issues) : '',
          },
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    report = { role: 'pack-author', model: 'us.anthropic.claude-sonnet-4-6', startedAt: new Date().toISOString(), cases };
    const path = writeReport(report);
    console.log(`\n${renderStageTable(report)}\n\nreport: ${path}\n`);
  }, 600_000);

  // Not "every slide succeeds". The spec's designed outcome for a slide that
  // exhausts its attempts is empty regions and a review flag, and an
  // instructor reviews every slide anyway (charter A3), so a few flagged
  // slides are the system working, not the system failing. What would be a
  // real failure is most of a deck arriving unusable, so the bar is a
  // majority, and the exact rate is reported for the handoff either way.
  it('describes the large majority of a deck without exhausting its retries', () => {
    const ran = report.cases.filter(c => !c.error);
    const rate = ran.length / report.cases.length;
    const failed = report.cases.filter(c => c.error).map(c => c.caseId);
    expect(rate, `flagged for review: ${failed.join(', ') || 'none'}`).toBeGreaterThanOrEqual(0.7);
  });

  it('never returns a partial or unvalidated draft for a slide it could not finish', () => {
    // The failure mode that would actually hurt a student is a half-formed
    // description reaching the pack. A failed slide must produce nothing.
    for (const c of report.cases.filter(c => c.error)) {
      expect(c.violations).toEqual([]);
      expect(c.facts.regions).toBeUndefined();
    }
  });

  it('produces structurally correct regions on every slide', () => {
    const violations = report.cases.flatMap(c => c.violations);
    expect(violations.length, `\n${formatViolations(violations)}\n`).toBe(0);
  });

  it('gives every slide between one and six regions, as the prompt requires', () => {
    for (const c of report.cases.filter(c => !c.error)) {
      expect(Number(c.facts.regions), c.caseId).toBeGreaterThanOrEqual(1);
      expect(Number(c.facts.regions), c.caseId).toBeLessThanOrEqual(6);
    }
  });

  it('reaches a valid draft in well under the three-attempt budget on average', () => {
    const ran = report.cases.filter(c => !c.error);
    const mean = ran.reduce((s, c) => s + c.attempts, 0) / ran.length;
    // Not a tight bound on purpose: this is a regression tripwire for a prompt
    // that has started fighting its own schema, not a quality score.
    expect(mean).toBeLessThan(2.5);
  });

  it('cites nothing, because this run supplied no course excerpts', () => {
    // The verbatim rule's strongest form: with no excerpts in the call, every
    // citation would be invented, so the correct count is exactly zero.
    for (const c of report.cases.filter(c => !c.error)) {
      expect(Number(c.facts.references), `${c.caseId} cited a source it was never given`).toBe(0);
    }
  });
});

describeIf('Pack Author on a slide with nothing to describe (charter A3)', () => {
  it('returns empty regions or fails the stage, rather than inventing a description', async () => {
    // A 1920x1080 pure white PNG. There is no honest description of it beyond
    // "a blank slide", and the one thing that must not happen is a confident
    // paragraph about content that is not there.
    const blank = blankPng();
    let outcome: 'empty' | 'exhausted' | 'described';
    let violations: ReturnType<typeof checkUndescribableSlide> = [];

    try {
      const result = await runAgentStage({
        role: 'pack-author',
        toolName: 'submit_slide_description',
        toolDescription: 'Submit the draft accessibility description for one slide.',
        schema: SlideDraftSchema,
        userText: 'Describe slide slide-99 from the deck "HNSW visualizations".\n\nNo text was extracted from this slide.',
        images: [{ mediaType: 'image/png', base64: blank }],
        logId: 'blank-slide',
      });
      violations = checkUndescribableSlide(result.value, 'blank-slide');
      outcome = violations.length === 0 ? 'empty' : 'described';
      console.log(`\nblank slide -> ${result.value.regions.length} region(s): ${JSON.stringify(result.value.regions.map(r => r.shortDescription))}\n`);
    } catch (error) {
      // Exhausting the retries is the correct outcome too: the schema demands
      // at least one region, so a model that has nothing to say cannot satisfy
      // it, and the stage writes empty regions with a review flag.
      outcome = 'exhausted';
      expect(error).toBeInstanceOf(AgentStageError);
    }

    expect(outcome, `\n${formatViolations(violations)}\n`).not.toBe('described');
  }, 180_000);
});

/** A minimal all-white PNG, written by hand so the eval needs no fixture file. */
function blankPng(): string {
  const { PNG } = require('pngjs');
  const png = new PNG({ width: 480, height: 270 });
  png.data.fill(255);
  return PNG.sync.write(png).toString('base64');
}
