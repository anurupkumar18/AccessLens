# AccessLens project status board

**Snapshot:** 2026-09-16. This is an execution board, not a statement that each
row is complete or demo-verified. “Owner” means the contributor evidenced by the
current branch/relay history; `Unassigned` means no owner was found, not that an
agent has silently claimed it.

## Status key

| Status | Meaning |
| --- | --- |
| **Building** | An independently testable feature is actively being implemented. |
| **Ready for QA** | Code-level work is complete; device, browser, or human evidence is still needed. |
| **Blocked externally** | Needs a real device, deployment authorization, institutional approval, or consented reviewer. |
| **Deferred by scope** | Useful future work that must not displace the core demo. |
| **Unassigned** | No active contributor owns the next step. |

## Whole-project task board

| Workstream | Owner | Status | Current evidence | Next independent action |
| --- | --- | --- | --- | --- |
| Explicit tab/window/display capture | Codex (QA integration); Jacob (capture foundation) | **Ready for QA** | `0347ad9` preserves browser activation, waits for instructor grant before session creation, and cleans up failed creation. | Run the Windows matrix; categorize any observed failure as AL-002. |
| Reviewed matching, correction, pause/stop/restart | Jacob Erard | **Ready for QA** | Part 2 capture/matcher/correction code and fixtures are merged. | Exercise against a clean unpacked extension and real source changes. |
| Instructor reviewed focus pointer | Codex | **Ready for QA** | AL-041 sends the existing semantic pointer field from reviewed region bounds and Focus renders an explicit marker. | Verify a clean unpacked extension and two-device path; preserve Read/Hear/AR equivalence. |
| Two student live experience and AR equivalent | Prachi Aswani | **Ready for QA** | Student/AR route is merged; local reading preferences added in `2427b1d`. | Keyboard, screen-reader, side-panel, and two-device QA. |
| Student self-paced Review route | Codex | **Ready for QA** | AL-040 renders a distinct non-live reviewed-pack route with Focus/Read/Hear/available AR views and local bookmarks. | Verify unpacked-extension navigation, bookmark reload, and narrow side-panel behavior. |
| Explicit local Review progress | Codex | **Ready for QA** | AL-043 provides an explicit, pack-scoped local concept marker and a private non-grade count. | Verify reload/keyboard behavior; do not infer activity, score, or send progress. |
| Review keyboard-equivalent formats | Codex | **Ready for QA** | AL-044 aligns Review’s Focus/Read/Hear/available-AR tabs with live-route Arrow/Home/End behavior. | Conduct unpacked-extension, narrow-panel, and screen-reader QA. |
| AWS WebSocket relay | Omar Rizwan | **Blocked externally** | Service and client exist; public endpoint passes the old 19-event path but rejects `capture.stopped`. | Part 4 resolves lifecycle validator/redeploy, then run two-device bench. |
| Lifecycle truth / false-live safeguards | Codex + Part 4 reviewer | **Ready for review** | `2d04fad` fail-closes invalid inbound relay events; AL-003 local changes await human review/deploy. | Human contract review and authorized service deployment. |
| Canvas read-only course materials and RAG | Codex | **Ready for review** | AL-045 adds a no-network, allowlist-only disabled provider seam; it is not Canvas or RAG. | Await institutional approval before any Canvas/LTI adapter, content retention, retrieval index, or RAG implementation. |
| Bedrock gateway and reviewed authoring | Codex | **Ready for review** | AL-042 adds a strict, no-network disabled gateway seam; it is not an enabled model connection. | Await approval for model/review/source-content policy before implementing an adapter or authoring flow. |
| Camera / gesture source adapter | Kunj Rathod / Unassigned | **Deferred by scope** | Roadmap only; charter requires explicit permission, local processing, manual fallback, and review. | Validate one physical lesson scenario and approval boundary before coding. |
| Anonymous session-context recording | Unassigned | **Blocked externally** | No approved retention/research policy; default remains no recording. | Decide consent, retention, deletion, and institutional review before implementation. |
| Mentor and accessibility feedback | Kunj Rathod / team | **Blocked externally** | Consent script and evidence table exist. | Run a voluntary formative session; record only approved feedback. |
| Rehearsal, fallback, and release language | Team | **Blocked externally** | Runbook and replay evidence packet exist; no two clean real-device rehearsals recorded. | Rehearse after the lifecycle deployment and device bench. |

## Build order: features first, integration later

1. **Build now:** AL-040 Review route from the reviewed pack; then independent
   focus pointer/caption presentation work once it has an owner.
2. **Build after human policy approval:** Canvas provider seam, Bedrock gateway,
   anonymous context export, and camera source adapter.
3. **Integrate in one or two passes:** Windows capture matrix, deployed lifecycle
   relay, two students/devices, screen-reader pass, rehearsals, fallback, and
   formative reviewer evidence.

## Source evidence

- Current feature-branch delivery records: `docs/work/`, `docs/CONTEXT_RELAY.md`,
  and `memory/episodic/`.
- Team ownership/current advanced-feature plan: `origin/master` commits by Prachi
  Aswani through `9ec8a25`, including `docs/ADVANCED_FEATURES.md`.
- Safety and current MVP boundaries: `docs/PROJECT_CHARTER.md` and
  `docs/TEAM_PRODUCT_DIRECTION.md`.

The advanced-feature plan informs build candidates, but it does not override the
charter or transform a planned capability into a current demo claim.
