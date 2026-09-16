# Charter amendment: the orb may generate, but never silently

**Status:** proposed by Part 5, **not yet agreed by the team.**
**Affects:** charter invariant **A9**, and `IMPLEMENTATION_PLAN.md` §2 Deferred.
**Implemented on:** `feature/orb-explainer` — the code exists; the agreement does not.

## What the orb does

A floating button on any page the student is reading. They press it and ask for
an explanation, simpler wording, or a diagram of whatever is on screen. Output
is spoken through the browser's own voices, shown as text, and drawn as an SVG
when they ask for one.

It is student-initiated and works without an instructor, a session, or a
reviewed pack.

## What that breaks

**A9 — "Unknown content produces an unmatched state, never an invented
description."** The orb explains arbitrary pages. That is inventing a
description of unreviewed content, which is exactly what A9 forbids. This is not
a technicality: A9 is why the demo's 2:00–2:30 beat is persuasive and why
`source.unmatched` exists in the contract at all.

**Access Packs require instructor review before publication.** The orb has no
pack. Generation happens at read time, for one student, with nobody reviewing it.

**`IMPLEMENTATION_PLAN.md` §2 lists "general screen understanding for arbitrary
software" as Deferred** — explicitly outside the 48-hour build.

**"No Canvas scraping without institutional approval."** Reading whatever Canvas
page the student has open is that, even though nothing is stored.

## The proposed amendment

A9 becomes:

> Unknown content produces an unmatched state in the instructor-led session, and
> is never described as though reviewed. Content the student explicitly asks the
> orb to explain may be generated, and is labelled as generated everywhere it
> appears — visually, in the accessibility tree, and in speech — before the
> student reads or hears it.

The operative change is **"never invents" → "never invents silently."**

## How that is enforced, not just promised

- `orb/provenance.ts` is the only way generated content is constructed, and it
  attaches a non-empty notice to every item.
- `speakableText()` puts the notice **first**, so an audio-only user learns the
  content is unverified before hearing it — not after, when they have already
  taken it as fact.
- The panel renders the notice as the first child of the result, so a screen
  reader walking the output reaches it first.
- `provenance.test.ts` asserts all of the above, including that the notice says
  plainly "not reviewed" and "may be wrong".
- The service prompt forbids claiming instructor endorsement and tells the model
  to say the page is too fragmentary rather than invent material.

## What is still true, deliberately

- **Nothing is stored.** The endpoint writes no request or response anywhere and
  logs only the mode, input size, and outcome — never page content.
- **Nothing leaves the device except visible text.** `pageContext.ts` skips
  inputs, hidden elements, and `aria-hidden` subtrees, and sends the URL path
  without its query string, which on an LMS routinely carries session ids.
  Verified in a real browser against a page containing a password field.
- **Speech is local.** The Web Speech API, not Polly: a route needing a network
  round trip fails exactly when the room's wifi does, and for some students
  speech is the primary access route, not an enhancement.
- **The instructor-led product is untouched.** Separate CDK stack, separate
  service, separate entry point. Deleting `orb/`, `services/orb-explain/`,
  `infra/lib/orb-explain-stack.ts`, and one line of `infra/bin/accesslens.ts`
  removes it completely.

## Known weaknesses

- **The Function URL has no authentication.** The caller is a content script on
  an arbitrary page, so there is no origin to authorise and no user identity to
  check. It stores nothing and holds no caller credentials, so the exposure is
  model spend rather than data — acceptable for a temporary event account,
  **not acceptable** for anything that outlives it.
- **The model can still be wrong in ways the label does not soften.** A
  confident, plausible, wrong explanation of a chemistry page is still wrong.
  The label is honest, not protective.
- **`activeTab`, `scripting`, and `http*://*/*` content-script matches** are far
  broader than the permissions `SYSTEM_DESIGN.md` §4 argues for. That is
  inherent to "works on any page" and should be said out loud in any demo that
  shows the permission prompt.

## The decision the team has to make

This is not mine to merge unilaterally. Four people built five parts against a
charter that says the system never invents, and this changes that sentence. If
the team does not want the amendment, the orb should be dropped rather than
quietly contradicting a document everyone else is still building to.
