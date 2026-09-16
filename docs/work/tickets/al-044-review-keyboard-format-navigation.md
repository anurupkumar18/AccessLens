---
id: AL-044
title: Review keyboard format navigation
status: IN_REVIEW
priority: P1
depends_on: [AL-040]
dependency_waiver: recorded
task_ids: [A9,A10,A11,A12,A13]
threads: []
affected_paths: [apps/extension/src/student]
contract_impact: none
data_impact: none
demo_impact: Makes the separate Review route keyboard-equivalent across reviewed Focus, Read, Hear, and available AR formats.
human_decision: none; equivalent navigation is required accessibility hardening within the current reviewed-pack route
---

## Outcome

Give Review format tabs the same arrow/Home/End keyboard behavior and ARIA tab
semantics as the live student route.

## Scope

Change only Review route selection/focus behavior. Each tab continues to render
the same reviewed asset/region meaning, and no preference, key, or activity data
is stored or transmitted.

## Non-goals

Do not add voice recognition, keyboard telemetry, student scoring, new modes,
content generation, or changes to live relay behavior.

## Acceptance criteria

Keyboard users can move Review format selection with ArrowLeft/ArrowRight/Home/End
and focus moves to the newly selected tab; unavailable AR is excluded safely.

## Test plan

Add a focused jsdom keyboard navigation test and extension typecheck, then include
the work in the next full repository batch.

## Failure behavior

When AR is unavailable, retain Focus/Read/Hear keyboard navigation rather than
leaving a tab reference to an absent renderer.

## Handoff requirements

State the equivalent keyboard route and that unpacked-extension/screen-reader
observations remain physical QA evidence.
