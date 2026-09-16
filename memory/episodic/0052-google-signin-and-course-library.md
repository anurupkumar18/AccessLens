# 0052 — Part 6: Google sign-in, professor accounts and the course library live

Date: 2026-09-16. Branch `integ/ui-api` (UI + API), continuing 0051.

## Goal

User decisions D12 and D13: replace the shared authoring bearer token with
Google sign-in; two roles (students never sign in, professors self-register,
anyone for now); professor accounts own a dataset of class resources the
pipeline retrieves from (spec section 9, the course library).

## Owner

Jacob, lead in the main session, implementing directly.

## Changed files

- `services/api/identity.ts`, `instructors.ts`, `getMe.ts`, `library.ts`
  and the seven profile/document/search handlers (no more 501s).
- `services/library/src/handler.ts` (indexer, rides in the ingest image as
  `library.handler`), `retrieveHandler.ts` (deck and slide retrieval),
  routes scoped by `ownerSub`.
- `services/publish/workflow.ts`: `DeckRetrieval`/`RetrieveForDeck` and
  `SlideRetrieval`/`RetrieveForSlide` when a retrieval ARN exists.
- `infra/lib/library-extension.ts` (vector bucket, indexer, retriever),
  stack tables (`Instructors`, `Profiles` + `ownerSub-index`,
  `LibraryDocuments` + `profileId-index`), JWT authorizer, per-route grants.
- `apps/extension`: `googleSignIn.ts`, `LibraryPanel.tsx`, `AuthoringPanel`
  sign-in and course picker, client methods, manifest `identity`.
- Docs: `VIZ_DECISIONS.md` D12/D13, `DEPLOY.md`, `VISUALIZATION_SYSTEM.md`,
  relay RL-042/043, thread T-41.

## Validation evidence

- `make check` green: 658 + 53 + 19 tests; synth shows the JWT authorizer on
  all 18 routes, retrieval states in the definition.
- Live (deploy with placeholder client id, `gcloud auth print-identity-token`):
  401 without a token; `/v1/me` created the account; profile `72b989fa…`;
  `lec05-slides.pdf` indexed to `ready` (30 pages, ~10 s); search returned
  pages 12/16/18 with scores 0.718/0.508/0.461; job `618f2ac0` ran
  `RetrieveForDeck` once and `RetrieveForSlide` eight times with zero
  references (unrelated material, correct); with the HNSW deck registered as
  a document, job `9bb663c0` cited six of eight slides by page.
- First deploy failed verify on a missing `s3vectors:GetVectors`; fixed.

## Blocker

The browser Sign in with Google button needs the deployment's own OAuth
web client id (T-41); only the Google Cloud account owner can create it.
The API is fully usable with gcloud tokens meanwhile.

## Next action

User creates the client id, sets `GOOGLE_CLIENT_ID`, `make deploy`, signs
in from the panel at http://localhost:5173, uploads a course document and a
deck. Then open the PR for `integ/ui-api` against `master`.
