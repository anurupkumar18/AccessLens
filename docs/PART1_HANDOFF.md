# Part 1 handoff: foundation and contracts

Phase 1, A1/A2 is implemented in the extension shell and `packages/contracts/`.
The built `dist/` directory can be loaded as an unpacked Chrome extension. The
UI has Instructor and Student routes, keyboard-focusable role navigation, and a
fixture event sent through `InMemorySessionClient` so the Student view follows
the Instructor view without network access.

Contracts are intentionally small and reject unknown fields. Zod is the runtime
authority used by the extension; checked-in JSON Schema artifacts provide the
interchange contract for future service validation. Student preferences are not
currently transmitted or persisted; future local settings must use
`chrome.storage.local` only.

Part 2 should emit the existing `LiveEvent` through `SessionClient`; Part 3
should subscribe to it and add renderers/AR without importing AWS. Part 4 can
replace `InMemorySessionClient` behind the interface. Part 5 owns the reviewed
biology pack and broader demo QA. Capture, AWS, camera, CV, and AR remain outside
this slice.
