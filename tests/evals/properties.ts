// Spec-derived properties an agent stage's output must satisfy.
//
// The user's goal for this build is "tests that an LLM creates appropriate
// resources (the ones that were specified)". Schema validity is necessary and
// nowhere near sufficient: a description that is 700 characters of confident
// invention passes `AccessPackSchema` cleanly. So every rule that
// `docs/VISUALIZATION_SYSTEM.md` and `docs/PROJECT_CHARTER.md` state about
// what a stage should produce is written here as a checkable property, and the
// evaluation suite runs real Bedrock output through them.
//
// These are deliberately pure and deterministic. Asking a second model whether
// the first model did well is a way to get a plausible answer to a question
// nobody checked. Where a property genuinely needs judgement -- "is this
// description faithful to the slide?" -- it is not in this file; it is a human
// line in the handoff, reported as a measured rate, not asserted as a pass.
import { AccessPackSchema, ArtifactManifestSchema, BLESSED_LIBRARIES } from '../../apps/extension/src/shared/contracts';
import { verifyReferences, type ClaimedReference, type Excerpt } from '../../services/shared/references';

export interface Violation {
  /** Stable id so a report can be diffed across runs. */
  rule: string;
  where: string;
  detail: string;
}

const ok: Violation[] = [];

export function words(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Pack Author (spec §8 stage 3, and the SYSTEM rules ported from build-pack.ts)

export interface DraftRegion {
  regionId: string;
  bounds: { x: number; y: number; width: number; height: number };
  shortDescription: string;
  plainLanguage: string;
}
export interface DraftSlide {
  title: string;
  readingOrder: string[];
  regions: DraftRegion[];
}

/**
 * Language that evaluates the slide or its author rather than describing it.
 * Charter A8 forbids grading and evaluation; the Pack Author prompt forbids
 * interpreting intent. A screen-reader user asked for the slide, not a review
 * of it.
 */
const EVALUATIVE = /\b(excellent|poorly|badly|beautiful|ugly|confusing|cluttered|well[- ]designed|effective|ineffective|should have|the author|the presenter|clearly the point|obviously)\b/iu;

/**
 * References to people. The prompt says never mention people, faces, or
 * anyone's characteristics -- charter A8 again, and A9's no-face-recognition
 * rule by the same logic.
 */
const PERSONHOOD = /\b(a man|a woman|a boy|a girl|his |her |he is|she is|people are smiling|the student|young|elderly|caucasian|asian|black man|white man)\b/iu;

/** Hedging that signals the model guessed rather than read. */
const SPECULATIVE = /\b(appears to|seems to|likely|presumably|probably|may be|might be|suggests that|implies that|possibly)\b/iu;

export function checkPackAuthorSlide(slide: DraftSlide, where: string): Violation[] {
  const v: Violation[] = [];
  const add = (rule: string, detail: string) => v.push({ rule, where, detail });

  if (slide.regions.length < 1 || slide.regions.length > 6) {
    add('regions.count', `expected 1..6 regions, got ${slide.regions.length}`);
  }

  const ids = slide.regions.map(r => r.regionId);
  if (new Set(ids).size !== ids.length) add('regions.unique', `duplicate regionId in ${ids.join(',')}`);
  for (const id of ids) {
    if (!/^[a-z0-9-]+$/.test(id)) add('regions.kebab', `regionId ${id!} is not lowercase kebab-case`);
  }

  for (const r of slide.regions) {
    const b = r.bounds;
    const inUnit = [b.x, b.y, b.width, b.height].every(n => n >= 0 && n <= 1);
    if (!inUnit) add('bounds.unit', `${r.regionId} bounds outside 0..1`);
    // A zero-area region cannot be cropped to in Focus mode or spoken as a
    // position in Locate mode, so it is not a region at all.
    if (b.width <= 0.01 || b.height <= 0.01) add('bounds.area', `${r.regionId} is degenerate (${b.width}x${b.height})`);
    if (b.x + b.width > 1.001 || b.y + b.height > 1.001) add('bounds.inside', `${r.regionId} extends past the slide edge`);

    if (words(r.shortDescription) > 60) add('shortDescription.words', `${r.regionId}: ${words(r.shortDescription)} words, cap is 60`);
    if (words(r.plainLanguage) > 35) add('plainLanguage.words', `${r.regionId}: ${words(r.plainLanguage)} words, cap is 35`);
    if (r.plainLanguage.trim() === r.shortDescription.trim()) {
      add('plainLanguage.distinct', `${r.regionId}: plainLanguage repeats shortDescription instead of simplifying it`);
    }

    for (const [rule, pattern] of [['evaluative', EVALUATIVE], ['personhood', PERSONHOOD], ['speculative', SPECULATIVE]] as const) {
      const hit = pattern.exec(r.shortDescription) ?? pattern.exec(r.plainLanguage);
      if (hit) add(`language.${rule}`, `${r.regionId}: ${JSON.stringify(hit[0])}`);
    }
  }

  // readingOrder is what Read mode walks. An id in it that names nothing, or a
  // region missing from it, means a student silently never hears that region.
  const known = new Set([...ids, 'title']);
  for (const step of slide.readingOrder) {
    if (!known.has(step)) add('readingOrder.dangling', `${step} names no region`);
  }
  for (const id of ids) {
    if (!slide.readingOrder.includes(id)) add('readingOrder.orphan', `${id} is never read aloud`);
  }
  if (slide.readingOrder.length === 0) add('readingOrder.empty', 'nothing would be read');

  // A heading is a heading. Past a dozen words the model has written a sentence
  // about the slide, and Read mode announces it before every region.
  if (words(slide.title) > 12) add('title.words', `${words(slide.title)} words; a title is a heading, not a sentence`);

  return v;
}

/**
 * Charter A3 and hard rule 2: a slide the describer cannot describe gets empty
 * regions and a review flag, never a guess. This is the property that is
 * easiest to lose and most expensive to lose, so the eval suite feeds a blank
 * slide and asserts it here.
 */
export function checkUndescribableSlide(slide: DraftSlide, where: string): Violation[] {
  if (slide.regions.length === 0) return ok;
  const invented = slide.regions.filter(r => words(r.shortDescription) > 8);
  if (invented.length === 0) return ok;
  return [{
    rule: 'undescribable.invented',
    where,
    detail: `a slide with no describable content produced ${invented.length} substantive description(s): ${JSON.stringify(invented[0].shortDescription).slice(0, 160)}`,
  }];
}

// ---------------------------------------------------------------------------
// Deck Analyst (spec §8 stage 2)

export interface Lessonish { subject: string; level: string; summary: string; concepts: { name: string; slideRange: [number, number] }[]; }

export function checkLesson(lesson: Lessonish, slideCount: number, where: string): Violation[] {
  const v: Violation[] = [];
  const add = (rule: string, detail: string) => v.push({ rule, where, detail });
  for (const c of lesson.concepts) {
    const [from, to] = c.slideRange;
    if (from < 1 || to > slideCount) add('concepts.range', `${c.name} spans ${from}..${to} of ${slideCount} slides`);
    if (from > to) add('concepts.ordered', `${c.name} has an inverted range`);
  }
  if (new Set(lesson.concepts.map(c => c.name.toLowerCase())).size !== lesson.concepts.length) {
    add('concepts.unique', 'the same concept is listed twice');
  }
  // "General" or "Various" is what a model says when it did not read the deck,
  // and it is worthless to every stage downstream that uses it for retrieval.
  if (/^(general|various|multiple|mixed|unknown|n\/a)$/i.test(lesson.subject.trim())) {
    add('subject.specific', `subject ${JSON.stringify(lesson.subject)} names nothing retrievable`);
  }
  if (words(lesson.summary) < 15) add('summary.substance', `${words(lesson.summary)}-word summary is not a paragraph`);
  return v;
}

// ---------------------------------------------------------------------------
// Viz Planner (spec §8 stage 5)

export interface Planish { decision: 'none' | 'retrieve' | 'adapt' | 'generate'; concept: string; rationale: string; }

/**
 * Restraint is the property that matters here. A title slide, an agenda, or a
 * quote does not want an interactive; producing one costs the instructor
 * review time and the student attention, and the spec makes `none` the default
 * on any doubt.
 */
export function checkPlanRestraint(plan: Planish, expected: 'none' | 'something', where: string): Violation[] {
  if (expected === 'none' && plan.decision !== 'none') {
    return [{ rule: 'plan.restraint', where, detail: `expected none for this slide, got ${plan.decision}: ${plan.rationale.slice(0, 160)}` }];
  }
  if (expected === 'something' && plan.decision === 'none') {
    return [{ rule: 'plan.opportunity', where, detail: `a slide with a diagram got none: ${plan.rationale.slice(0, 160)}` }];
  }
  if (plan.decision !== 'none' && plan.concept.trim().length < 3) {
    return [{ rule: 'plan.concept', where, detail: 'a non-none plan with no concept gives the retriever nothing to query' }];
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Adapter and Generator (spec §8 stages 7a, 7b, and §4)

export function checkArtifactManifest(manifest: unknown, where: string): Violation[] {
  const parsed = ArtifactManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return parsed.error.issues.map(i => ({ rule: 'manifest.schema', where, detail: `${i.path.join('.')}: ${i.message}` }));
  }
  const m = parsed.data;
  const v: Violation[] = [];
  const add = (rule: string, detail: string) => v.push({ rule, where, detail });

  for (const lib of m.libraries) {
    if (!(BLESSED_LIBRARIES as readonly string[]).includes(lib)) add('manifest.library', `${lib} is not blessed`);
  }
  // Charter A7 is the reason these two fields are required, but a required
  // field can still be filled with nothing useful. "Interactive visualization"
  // is not an accessible description of anything.
  if (words(m.accessibility.description) < 8) add('a11y.description', 'the accessible description is too thin to replace the picture');
  if (words(m.accessibility.keyboard) < 4) add('a11y.keyboard', 'no real keyboard route is described');
  if (/^(a|an|the)? ?(interactive|visualization|diagram|chart|graph)\.?$/i.test(m.accessibility.description.trim())) {
    add('a11y.description', 'the accessible description restates the medium instead of the content');
  }
  return v;
}

/**
 * The artifact's own code, checked statically. The sandbox will enforce all of
 * this at render time, but catching it here turns a wasted repair loop into an
 * immediate, specific correction.
 */
export function checkArtifactHtml(html: string, where: string): Violation[] {
  const v: Violation[] = [];
  const add = (rule: string, detail: string) => v.push({ rule, where, detail });

  if (!/window\.accesslensInit\s*=|function\s+accesslensInit/.test(html)) {
    add('artifact.init', 'accesslensInit is never defined, so the viewer has nothing to call');
  }
  const external = /<script[^>]+src\s*=\s*["'](https?:)?\/\//i.exec(html);
  if (external) add('artifact.external-script', `loads ${external[0].slice(0, 80)}; the sandbox CSP is script-src 'self'`);
  for (const [rule, pattern] of [
    // No trailing \b on these: `fetch(` and `window.parent.` end in punctuation,
    // and a word boundary after punctuation only matches when a word character
    // happens to follow -- which silently turned this rule off once already.
    ['artifact.network', /\bfetch\s*\(|\bXMLHttpRequest\b|\bnavigator\.sendBeacon\b|\bnew\s+WebSocket\b|\bEventSource\b/],
    ['artifact.storage', /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b/],
    ['artifact.parent', /\bwindow\.parent\.|\bwindow\.top\.|\bdocument\.domain\b/],
  ] as const) {
    const hit = pattern.exec(html);
    // connect-src 'none' and an opaque origin make these throw at runtime, so
    // an artifact that reaches for them has simply misunderstood its sandbox.
    if (hit) add(rule, `uses ${hit[0]}, which the sandbox denies`);
  }
  if (!/aria-live|role="status"|role="alert"/i.test(html)) {
    add('artifact.live-region', 'no live region, so a screen-reader user is told nothing when the visual state changes');
  }
  if (!/keydown|keyup|keypress|tabindex/i.test(html)) {
    add('artifact.keyboard', 'no keyboard handling, so the declared keyboard route does not exist');
  }
  return v;
}

// ---------------------------------------------------------------------------
// References, at every stage that can emit them (spec §9.4)

/**
 * The property is not "the model cited something" but "everything the model
 * cited survives the verbatim check". A stage whose references are routinely
 * dropped is a stage whose prompt is not working, and the drop count is the
 * signal that says so.
 */
export function checkReferences(claimed: ClaimedReference[], excerpts: Excerpt[], where: string): Violation[] {
  const { dropped } = verifyReferences(claimed, excerpts);
  return dropped.map(d => ({
    rule: `references.${d.reason}`,
    where,
    detail: `${d.reference.docId} p${d.reference.page}: ${JSON.stringify(d.reference.quote).slice(0, 120)}`,
  }));
}

// ---------------------------------------------------------------------------
// The whole published pack

export function checkPublishedPack(pack: unknown, where: string): Violation[] {
  const parsed = AccessPackSchema.safeParse(pack);
  if (!parsed.success) {
    return parsed.error.issues.map(i => ({ rule: 'pack.schema', where, detail: `${i.path.join('.')}: ${i.message}` }));
  }
  const v: Violation[] = [];
  const add = (rule: string, detail: string) => v.push({ rule, where, detail });
  const p = parsed.data;

  if (!p.matching) add('pack.matching', 'no matching block, so the capture matcher has no thresholds to read');
  const fingerprints = p.assets.map(a => a.fingerprint);
  if (new Set(fingerprints).size !== fingerprints.length) {
    add('pack.fingerprints', 'two slides share a fingerprint; the matcher cannot tell them apart');
  }
  for (const a of p.assets) {
    // Hard rule 4: the authoring pipeline never writes arScene.
    if (a.arScene) add('pack.arScene', `${a.assetId} carries arScene, which this pipeline must never write`);
    if (!a.mediaUri) add('pack.mediaUri', `${a.assetId} has no slide image`);
    for (const r of a.regions) {
      if (r.audioUri && !r.audioUri.endsWith('.mp3')) add('pack.audio', `${a.assetId}/${r.regionId} audioUri is not an mp3`);
    }
    if (a.visualization) {
      const declared = Object.keys(a.visualization.regionMap ?? {});
      const regionIds = new Set(a.regions.map(r => r.regionId));
      for (const id of declared) {
        if (!regionIds.has(id)) add('pack.regionMap', `${a.assetId} maps unknown region ${id}`);
      }
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// Reporting

export function summarise(violations: Violation[]): string {
  if (violations.length === 0) return 'no violations';
  const byRule = new Map<string, number>();
  for (const v of violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
  return [...byRule.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rule, n]) => `${rule} x${n}`)
    .join(', ');
}

export function formatViolations(violations: Violation[]): string {
  return violations.map(v => `  [${v.rule}] ${v.where}: ${v.detail}`).join('\n');
}
