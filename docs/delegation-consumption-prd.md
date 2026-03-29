# Delegation Consumption PRD

## Problem

The broker now owns a richer delegation decision:

- it infers concrete task archetypes from the user ask and workspace context
- it ranks candidates using broker-owned metadata and search evidence
- it returns one recommendation:
  - `delegate-now`
  - `review-shortlist`
  - `handle-locally`

The plugin must use that decision directly. If the plugin keeps acting like a generic search wrapper, users will not experience delegation as natural or magical.

## Goal

Make the Registry Broker plugin feel like a native Codex delegation layer:

- recognize task-shaped prompts early
- call the broker with enough workspace context to get a strong decision
- trust the broker recommendation instead of rebuilding ranking policy locally
- present the result in a way that makes the next action obvious

## Users

- Codex users solving engineering tasks
- Codex users doing product strategy and research
- Codex users drafting business plans, GTM work, or investor materials
- Codex users designing landing pages, onboarding flows, or UX surfaces

## Desired Outcome

When a user asks for help on a bounded subtask, the plugin should naturally route to the broker and produce one of three outcomes:

1. `delegate-now`
   The plugin should treat the broker recommendation as the primary answer and move directly into summon-ready or summon-first behavior.

2. `review-shortlist`
   The plugin should show the shortlist and explain why multiple candidates are viable.

3. `handle-locally`
   The plugin should avoid noisy delegation suggestions and explain that local handling is the better default.

## Representative User Prompts

- "Fix this TypeScript plugin bug and verify the patch."
- "Write a business plan and GTM strategy for this product."
- "Create an investor-ready pitch deck."
- "Design a landing page and onboarding UX for this feature."
- "Draft launch messaging and lifecycle email copy."
- "Research the market and compare us against alternatives."

The plugin should not need bespoke per-prompt routing logic for each of these. It should pass the right context and let the broker classify them.

## Plugin Responsibilities

The plugin should:

- collect compact workspace context whenever the task is non-trivial
- call `registryBroker.delegate` early for task-shaped requests
- prefer broker `recommendation` over local candidate ranking
- only use local ranking as a presentation fallback when broker recommendation is missing
- preserve direct-UAID workflows when the user already knows the target
- make the recommendation visible in tool summaries and user-facing MCP output

The plugin should not:

- invent a second recommendation engine
- maintain a parallel task taxonomy separate from the broker
- silently downgrade `delegate-now` into a generic shortlist unless broker auth or messaging constraints require it

## Input Requirements

For meaningful tasks, the plugin should pass:

- `task`
- `context`
- `workspace.openFiles`
- `workspace.modifiedFiles`
- `workspace.relatedPaths`
- `workspace.errors`
- `workspace.commands`
- `workspace.languages`

These fields should stay compact and bounded. The plugin should send enough signal to help the broker infer code, design, strategy, marketing, or operations work, but it should not dump the entire workspace.

## UX Requirements

### For `delegate-now`

- show the recommended candidate first
- include the broker reason
- preserve the broker-supplied suggested message
- make `summonAgent` the obvious next action

### For `review-shortlist`

- show the top candidates in score order
- explain why the top candidates are close
- keep broker reasons visible instead of replacing them with plugin-generated copy

### For `handle-locally`

- do not spam users with search results
- explain that the task looks small or local-first

## Example Outcome Expectations

### Coding task

- likely result: `review-shortlist` or `delegate-now`
- common opportunities: `implementation-specialist`, `verification-specialist`

### Business-plan task

- likely result: `delegate-now`
- common opportunities: `strategy-specialist`

### Landing-page or UX task

- likely result: `delegate-now`
- common opportunities: `design-specialist`, sometimes `marketing-specialist`

## Verification Requirements

Local:

- point the plugin at the live local dockerized broker
- verify `registryBroker.delegate` returns the expected recommendation for:
  - code task
  - business-plan task
  - design task
- verify the plugin summary reflects the broker recommendation without local re-ranking drift

Production:

- point the plugin at `https://hol.org/registry/api/v1`
- verify the same task shapes return live broker recommendations through the plugin consumer path
- verify the plugin output exposes the recommendation clearly

## Definition of Done

- the plugin is delegation-plan-first for task-shaped work
- workspace context is forwarded consistently
- broker recommendation is the primary control signal
- business, design, marketing, and coding asks all flow through the same broker-native path
- local and production verification prove the plugin consumer path works with live broker responses
