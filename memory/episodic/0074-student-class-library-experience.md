# Student class library experience

## Goal

Complete AL-057: make the approval-gated AL-056 class assistant usable from
the student extension without merging it into the live semantic relay.

## Changed files

- Added a class-library API client for invite redemption and cited questions.
- Added the Class library student surface with Google sign-in, a separately
  stored local session, a selected local enrollment, source/page citations,
  provisional labels, declines, and local task removal.
- Added shell navigation and tests; local task storage never gains a network
  dependency.

## Validation evidence

Root TypeScript passes. Nineteen focused tests across Google sign-in, the
classroom client, the class assistant, local tasks, and the app shell pass.
Relay and delivery-board checks also pass.

## Blocker

The server remains disabled by default. A real pilot still needs OAuth client
configuration and the human activation prerequisites; no student history is
introduced by this UI.

## Owner

Codex, at Anurup Kumar's direction; ticket AL-057.

## Next action

Run the complete repository gate, open the dependent PR, then begin the
production data-plane hardening work only after its policy review.
