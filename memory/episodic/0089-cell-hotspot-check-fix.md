# Cell hotspot check fix

## Goal

Keep the AR semantic test aligned with the reviewed cell deck's expanded
hotspot map.

## Changed files

- `apps/extension/src/ar/cellScene.test.ts`
- `package.json`
- `package-lock.json`
- `docs/CONTEXT_RELAY.md`

## Validation evidence

- `cellScene.test.ts`: 2 tests passed.
- Root typecheck resolves the Bedrock Agent Runtime and SageMaker Runtime SDKs.
- The missing root AWS SDK dependencies are now declared and locked.

## Known limits

The full repository test command was also run on Windows. Some unrelated tests
remain environment-sensitive: child-package Vitest config resolution, `python3`
subprocess execution, Linux temporary paths, generated line endings, and agent
 fixture paths.

## Blocker

No code blocker remains. Real-browser visual QA of the five AR scene variants is
still manual.

## Owner

Prachi / Codex local AR work branch.

## Next action

Run the project on localhost and manually verify the five cell-slide AR scenes.
