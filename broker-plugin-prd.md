# Broker Plugin PRD

## Objective

Make the HOL Registry Broker Codex plugin feel native during real problem solving, not just as a thin API wrapper. The plugin should help Codex decide when to delegate, shape a high-quality handoff, preview the exact outbound work, and recover useful broker state without forcing the user to inspect raw payloads.

## Current State

The plugin already supports four core flows:

- delegation planning through `registryBroker.delegate`
- shortlist inspection through `registryBroker.findAgents`
- live dispatch through `registryBroker.summonAgent`
- session recovery through `registryBroker.sessionHistory`

The current implementation is operational, but it still has several UX and operator gaps:

- handoffs are task-shaped but under-specified for real engineering work
- dispatch is all-or-nothing, with no preview path before sending
- tool payloads are raw enough that Codex still has to infer the next action
- session history is returned, but not summarized into something easy to use in follow-up work
- the MCP layer has grown large enough that feature additions risk making the plugin harder to maintain

## Best-in-Class Requirements

### 1. Structured delegation briefs

Codex should be able to pass a bounded task with the same fields a good staff engineer would use when delegating:

- primary task
- optional context
- desired deliverable
- hard constraints
- required inclusions
- acceptance criteria

The plugin should turn that into a compact broker planning context and a clean dispatch brief without duplicating logic across tools.

### 2. Safe dispatch preview

The plugin needs a non-destructive preview mode for `registryBroker.summonAgent` that:

- selects the same candidate it would send to
- builds the exact outbound message
- returns the selected opportunity and candidate metadata
- does not open a broker session or send a message

This is the missing “operator confidence” feature for high-trust use.

### 3. Actionable tool outputs

Tool responses should tell Codex what to do next instead of only returning raw JSON. At minimum:

- `delegate` should expose a normalized next action
- `findAgents` should expose a summon-ready suggestion for the best candidate
- `summonAgent` should expose the actual session ids and whether the call was a dry run
- `sessionHistory` should expose a concise summary of the latest broker conversation state

### 4. Maintainable MCP contracts

The current MCP layer should be split so new behavior does not keep expanding the largest source files. Shared tool schemas and brief-formatting helpers should live outside the main MCP file.

## Non-Goals

- replacing broker-native ranking or planner logic
- adding new broker endpoints
- adding UI or browser-only behavior
- changing the public broker authentication model

## Success Criteria

- Codex can pass structured delegation metadata to `delegate`, `findAgents`, and `summonAgent`
- `summonAgent` supports a true dry-run mode
- the plugin returns explicit next-action guidance in its payloads
- `sessionHistory` summarizes the latest session in a useful way
- tests cover the new contract behavior
- the live broker-backed smoke test still passes

## Technical Approach

- add a shared delegation-brief contract and formatter module
- add a shared tool-schema module so structured fields stay consistent
- add a result-formatting module for next-action and session-history summaries
- update the MCP handlers to consume the shared brief and result helpers
- extend tests first for structured briefs, dry-run dispatch, and session-history summaries
- extend the broker-backed E2E harness to exercise the new dry-run path
