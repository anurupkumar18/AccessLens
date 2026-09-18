# AccessLens one-page guide

## Goal

Create a concise, source-grounded one-page guide that explains how to run the
AccessLens demo and why its extension-first, semantic-event design is the best
fit for the current MVP.

## Changed files

- `scripts/build_accesslens_one_pager.py`
- `output/pdf/accesslens-one-pager.pdf`
- `docs/CONTEXT_RELAY.md`
- `memory/INDEX.md`

## Validation evidence

- The source `docs/One Pager.pdf` was inspected as a 20-page hackathon guide.
- The generated deliverable contains exactly one landscape Letter page.
- Text extraction and PyMuPDF raster preview were checked; the final layout has
  no clipped content.
- Claims are grounded in the current charter, product direction, implementation
  plan, system design, demo brief, and runbook.

## Blocker

No blocker for the document. The real-browser capture matrix and external
accessibility review remain open product evidence, so the one-pager labels them
as limits or next proof rather than claiming completion.

## Owner

Codex / Prachi local AR work branch.

## Next action

Use the one-pager in the demo/pitch handoff and update it only when the source of
truth or measured evidence changes.
