# Decision: approval-gated course library and cited class assistant

**Date:** 2026-09-16
**Decided by:** Anurup Kumar, through the implementation request in this task
**Status:** Approved for a synthetic/public-content implementation slice; real
course-content activation remains gated
**Charter:** A3, A4, A5, A6, A8, A10

## Decision

AccessLens may implement a private instructor-owned, class-scoped library and
cited student assistant. It uses Google-authenticated membership and expiring
invites, stores no student question or answer history, and keeps student action
items only in extension-local storage. The class library is separate from the
temporary live semantic relay.

PDF ingestion, vector indexing, facts, and answers are initially restricted to
checked-in synthetic or public content. Real course-content activation requires
the charter's human review gate, an explicit retention/deletion review, and any
applicable institutional approval. Automated schedule and recap extraction is
student-visible only as cited **Provisional** information until instructor
publication; published instructor facts take precedence.

## Supersedes

This resolves only the implementation ambiguity identified in T-29 and the
deferred AL-013/020/021/022/023 tickets. It does **not** supersede their real
content, institutional, or release-claim approval requirements.
