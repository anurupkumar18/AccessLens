// The property checks that judge model output, judged themselves.
//
// RL-011 and RL-014 on this project both record the same failure: a check that
// looked green because it could not go red. These checks decide whether a
// description a blind student will hear is acceptable, so every rule below is
// exercised against an input that must trip it and a control that must not.
import { describe, it, expect } from 'vitest';
import {
  checkPackAuthorSlide, checkUndescribableSlide, checkLesson, checkPlanRestraint,
  checkArtifactManifest, checkArtifactHtml, checkReferences, checkPublishedPack,
  words, summarise, type DraftSlide,
} from './properties';
import catalogManifest from '../../apps/viewer/fixtures/artifacts/catalog.manifest.json';
import publishedPack from '../../apps/viewer/fixtures/published-pack.json';

const goodSlide = (): DraftSlide => ({
  title: 'HNSW search',
  readingOrder: ['title', 'graph'],
  regions: [{
    regionId: 'graph',
    bounds: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
    shortDescription: 'A three-layer graph. The search enters at the top layer and descends to layer zero.',
    plainLanguage: 'A picture of how the search jumps between layers.',
  }],
});

const rules = (vs: { rule: string }[]) => vs.map(v => v.rule);

describe('checkPackAuthorSlide', () => {
  it('passes a well-formed slide — the control, without which every rule below is vacuous', () => {
    expect(checkPackAuthorSlide(goodSlide(), 's')).toEqual([]);
  });

  it('flags more than six regions', () => {
    const s = goodSlide();
    s.regions = Array.from({ length: 7 }, (_, i) => ({ ...goodSlide().regions[0], regionId: `r-${i}` }));
    s.readingOrder = ['title', ...s.regions.map(r => r.regionId)];
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('regions.count');
  });

  it('flags zero regions on a slide claimed to be describable', () => {
    const s = goodSlide(); s.regions = []; s.readingOrder = ['title'];
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('regions.count');
  });

  it('flags a duplicate regionId', () => {
    const s = goodSlide();
    s.regions = [s.regions[0], { ...s.regions[0] }];
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('regions.unique');
  });

  it('flags a regionId that is not kebab-case', () => {
    const s = goodSlide(); s.regions[0].regionId = 'The Graph'; s.readingOrder = ['title', 'The Graph'];
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('regions.kebab');
  });

  it('flags a degenerate region, which Focus mode cannot crop to', () => {
    const s = goodSlide(); s.regions[0].bounds = { x: 0.5, y: 0.5, width: 0, height: 0 };
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('bounds.area');
  });

  it('flags a region that runs off the slide', () => {
    const s = goodSlide(); s.regions[0].bounds = { x: 0.8, y: 0.1, width: 0.5, height: 0.2 };
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('bounds.inside');
  });

  it('flags a shortDescription past the 60-word cap a screen reader has to speak', () => {
    const s = goodSlide(); s.regions[0].shortDescription = 'word '.repeat(61);
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('shortDescription.words');
  });

  it('flags a plainLanguage past the 35-word cap', () => {
    const s = goodSlide(); s.regions[0].plainLanguage = 'word '.repeat(36);
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('plainLanguage.words');
  });

  it('flags plainLanguage that merely copies shortDescription instead of simplifying it', () => {
    const s = goodSlide(); s.regions[0].plainLanguage = s.regions[0].shortDescription;
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('plainLanguage.distinct');
  });

  it('flags evaluative language, which charter A8 forbids', () => {
    const s = goodSlide(); s.regions[0].shortDescription = 'A beautiful and well-designed diagram of the layers.';
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('language.evaluative');
  });

  it('flags a description of a person', () => {
    const s = goodSlide(); s.regions[0].shortDescription = 'A photograph in which a man points at the board.';
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('language.personhood');
  });

  it('flags speculation, which is how invention sounds', () => {
    const s = goodSlide(); s.regions[0].shortDescription = 'A diagram that appears to show three layers of nodes.';
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('language.speculative');
  });

  it('flags a readingOrder entry that names no region', () => {
    const s = goodSlide(); s.readingOrder = ['title', 'graph', 'legend'];
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('readingOrder.dangling');
  });

  it('flags a region a student would never hear', () => {
    const s = goodSlide();
    s.regions.push({ ...s.regions[0], regionId: 'caption' });
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('readingOrder.orphan');
  });

  it('flags a title that is a sentence rather than a heading', () => {
    const s = goodSlide(); s.title = 'This slide explains how the hierarchical navigable small world graph search works in practice';
    expect(rules(checkPackAuthorSlide(s, 's'))).toContain('title.words');
  });
});

describe('checkUndescribableSlide — charter A3, the property most expensive to lose', () => {
  it('accepts empty regions, which is the correct answer for a slide with nothing to describe', () => {
    expect(checkUndescribableSlide({ title: 'Untitled', readingOrder: [], regions: [] }, 's')).toEqual([]);
  });

  it('flags a substantive description invented for a blank slide', () => {
    const s = goodSlide();
    expect(rules(checkUndescribableSlide(s, 's'))).toContain('undescribable.invented');
  });

  it('tolerates a terse placeholder, which is not the same as a guess', () => {
    const s: DraftSlide = { title: 'Blank', readingOrder: ['body'], regions: [{ regionId: 'body', bounds: { x: 0, y: 0, width: 1, height: 1 }, shortDescription: 'A blank slide.', plainLanguage: 'Nothing here.' }] };
    expect(checkUndescribableSlide(s, 's')).toEqual([]);
  });

  it('tolerates a long but accurate report of an absence, which is honesty and not invention', () => {
    // Observed verbatim from a real evaluation run against a white PNG.
    const s: DraftSlide = { title: 'Blank', readingOrder: ['body'], regions: [{ regionId: 'body', bounds: { x: 0, y: 0, width: 1, height: 1 }, shortDescription: 'The slide appears entirely white with no visible text, diagrams, or other content.', plainLanguage: 'This slide is empty.' }] };
    expect(checkUndescribableSlide(s, 's')).toEqual([]);
  });

  it('still flags a confident description of content that is not there', () => {
    const s: DraftSlide = { title: 'Overview', readingOrder: ['body'], regions: [{ regionId: 'body', bounds: { x: 0, y: 0, width: 1, height: 1 }, shortDescription: 'A three-column table comparing recall, latency, and memory for four index types.', plainLanguage: 'A table comparing four ways of indexing.' }] };
    expect(rules(checkUndescribableSlide(s, 's'))).toContain('undescribable.invented');
  });
});

describe('checkLesson', () => {
  const lesson = { subject: 'Information retrieval', level: 'Graduate', summary: 'word '.repeat(40), concepts: [{ name: 'Layered graphs', slideRange: [1, 4] as [number, number] }] };

  it('passes a well-formed lesson', () => {
    expect(checkLesson(lesson, 10, 'deck')).toEqual([]);
  });

  it('flags a concept pointing past the end of the deck', () => {
    expect(rules(checkLesson({ ...lesson, concepts: [{ name: 'x', slideRange: [1, 99] }] }, 10, 'deck'))).toContain('concepts.range');
  });

  it('flags an inverted slide range', () => {
    expect(rules(checkLesson({ ...lesson, concepts: [{ name: 'x', slideRange: [8, 2] }] }, 10, 'deck'))).toContain('concepts.ordered');
  });

  it('flags a subject that names nothing retrievable', () => {
    expect(rules(checkLesson({ ...lesson, subject: 'General' }, 10, 'deck'))).toContain('subject.specific');
  });

  it('flags a summary that is not a paragraph', () => {
    expect(rules(checkLesson({ ...lesson, summary: 'A deck.' }, 10, 'deck'))).toContain('summary.substance');
  });

  it('flags the same concept listed twice', () => {
    expect(rules(checkLesson({ ...lesson, concepts: [{ name: 'A', slideRange: [1, 2] }, { name: 'a', slideRange: [3, 4] }] }, 10, 'deck'))).toContain('concepts.unique');
  });
});

describe('checkPlanRestraint', () => {
  it('accepts none for a slide that should get none', () => {
    expect(checkPlanRestraint({ decision: 'none', concept: '', rationale: 'agenda slide' }, 'none', 's')).toEqual([]);
  });

  it('flags an interactive proposed for an agenda slide', () => {
    expect(rules(checkPlanRestraint({ decision: 'generate', concept: 'agenda', rationale: 'could animate' }, 'none', 's'))).toContain('plan.restraint');
  });

  it('flags none returned for a slide with a real diagram', () => {
    expect(rules(checkPlanRestraint({ decision: 'none', concept: '', rationale: 'unsure' }, 'something', 's'))).toContain('plan.opportunity');
  });

  it('flags a non-none plan with no concept, which gives the retriever nothing', () => {
    expect(rules(checkPlanRestraint({ decision: 'retrieve', concept: '', rationale: 'r' }, 'something', 's'))).toContain('plan.concept');
  });
});

describe('checkArtifactManifest', () => {
  it('passes the checked-in catalog fixture', () => {
    expect(checkArtifactManifest(catalogManifest, 'a')).toEqual([]);
  });

  it('reports every schema failure rather than only the first', () => {
    const bad = { ...catalogManifest, libraries: ['jquery@3'], interaction: 'vibes' };
    expect(rules(checkArtifactManifest(bad, 'a'))).toContain('manifest.schema');
  });

  it('flags an accessible description that restates the medium instead of the content', () => {
    const m = structuredClone(catalogManifest) as any;
    m.accessibility.description = 'An interactive visualization.';
    expect(rules(checkArtifactManifest(m, 'a'))).toContain('a11y.description');
  });

  it('flags a keyboard route that says nothing', () => {
    const m = structuredClone(catalogManifest) as any;
    m.accessibility.keyboard = 'Use keys.';
    expect(rules(checkArtifactManifest(m, 'a'))).toContain('a11y.keyboard');
  });
});

describe('checkArtifactHtml', () => {
  const good = `<!doctype html><html><body><div id="c" tabindex="0"></div><div aria-live="polite" id="s"></div>
    <script>window.accesslensInit=function(p,ctx){document.addEventListener('keydown',function(){});};</script></body></html>`;

  it('passes an artifact that defines init, handles keys, and announces state', () => {
    expect(checkArtifactHtml(good, 'a')).toEqual([]);
  });

  it('flags an artifact that never defines accesslensInit', () => {
    expect(rules(checkArtifactHtml('<html><body></body></html>', 'a'))).toContain('artifact.init');
  });

  it('flags an external script, which the sandbox CSP blocks', () => {
    expect(rules(checkArtifactHtml(good + '<script src="https://cdn.example.com/d3.js"></script>', 'a'))).toContain('artifact.external-script');
  });

  it('flags a network call, since connect-src is none', () => {
    expect(rules(checkArtifactHtml(good.replace('keydown', 'keydown\'); fetch(\'/x'), 'a'))).toContain('artifact.network');
  });

  it('flags storage access, which an opaque origin denies', () => {
    expect(rules(checkArtifactHtml(good + '<script>localStorage.setItem("a","b")</script>', 'a'))).toContain('artifact.storage');
  });

  it('flags reaching for the parent frame', () => {
    expect(rules(checkArtifactHtml(good + '<script>window.parent.postMessage(1)</script>', 'a'))).toContain('artifact.parent');
  });

  it('flags a visual-only artifact with no live region (charter A7)', () => {
    expect(rules(checkArtifactHtml(good.replace('aria-live="polite"', 'class="x"'), 'a'))).toContain('artifact.live-region');
  });

  it('flags an artifact with no keyboard handling at all', () => {
    expect(rules(checkArtifactHtml(good.replace(/tabindex="0"/, '').replace(/keydown/, 'click'), 'a'))).toContain('artifact.keyboard');
  });
});

describe('checkReferences', () => {
  const excerpts = [{ chunkId: 'c', docId: 'd', title: 'T', page: 4, score: 1, text: 'the search starts from the top layer' }];

  it('passes a citation the model was actually shown', () => {
    expect(checkReferences([{ docId: 'd', page: 4, quote: 'starts from the top layer' }], excerpts, 'a')).toEqual([]);
  });

  it('flags a paraphrase', () => {
    expect(rules(checkReferences([{ docId: 'd', page: 4, quote: 'begins at the highest layer' }], excerpts, 'a')))
      .toContain('references.quote-not-verbatim-in-excerpt');
  });

  it('flags a real quote attached to the wrong page', () => {
    expect(rules(checkReferences([{ docId: 'd', page: 9, quote: 'starts from the top layer' }], excerpts, 'a')))
      .toContain('references.no-excerpt-for-doc-and-page');
  });
});

describe('checkPublishedPack', () => {
  it('passes the published-pack fixture', () => {
    expect(checkPublishedPack(publishedPack, 'p')).toEqual([]);
  });

  it('flags arScene, which this pipeline must never write', () => {
    const p = structuredClone(publishedPack) as any;
    p.assets[0].arScene = { modelUri: 'm.glb', defaultCamera: 'c', hotspots: [] };
    expect(rules(checkPublishedPack(p, 'p'))).toContain('pack.arScene');
  });

  it('flags two slides sharing a fingerprint, which the matcher cannot separate', () => {
    const p = structuredClone(publishedPack) as any;
    p.assets[1].fingerprint = p.assets[0].fingerprint;
    expect(rules(checkPublishedPack(p, 'p'))).toContain('pack.fingerprints');
  });

  it('flags a regionMap naming a region the slide does not have', () => {
    const p = structuredClone(publishedPack) as any;
    p.assets[0].visualization.regionMap = { nosuch: 'layer-0' };
    expect(rules(checkPublishedPack(p, 'p'))).toContain('pack.regionMap');
  });

  it('flags a missing matching block', () => {
    const p = structuredClone(publishedPack) as any;
    delete p.matching;
    expect(rules(checkPublishedPack(p, 'p'))).toContain('pack.matching');
  });

  it('flags a slide with no image', () => {
    const p = structuredClone(publishedPack) as any;
    delete p.assets[0].mediaUri;
    expect(rules(checkPublishedPack(p, 'p'))).toContain('pack.mediaUri');
  });
});

describe('helpers', () => {
  it('counts words the way the caps mean them', () => {
    expect(words('  a  b\nc ')).toBe(3);
    expect(words('')).toBe(0);
  });

  it('summarises violations by rule and frequency', () => {
    expect(summarise([{ rule: 'a', where: 'w', detail: 'd' }, { rule: 'a', where: 'w', detail: 'd' }, { rule: 'b', where: 'w', detail: 'd' }]))
      .toBe('a x2, b x1');
    expect(summarise([])).toBe('no violations');
  });
});
