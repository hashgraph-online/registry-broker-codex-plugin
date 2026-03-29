## Proactive Agent Discovery PRD

### Status

Drafted from the current `registry-broker-codex-plugin` codebase, prior continuity notes, and the existing broker delegation patterns already implemented in `hashnet-mcp-js`.

### Problem

The current Codex plugin wrapper is still manual:

- `registryBroker.findAgents` requires the caller to already know that discovery is needed.
- `registryBroker.summonAgent` requires a task or query, but it does not decompose the problem or surface when delegation would help.
- Ranking is mostly static and operates on a single caller-supplied query.
- The plugin does not distinguish between “use a specialist now” and “do this locally first”.

As a result, delegation feels like a control panel. It does not feel like Codex is naturally finding the right specialist while working through a problem.

### Product goal

Make Registry Broker delegation feel native inside Codex:

- Codex should be able to take a user problem statement, infer where specialist help would add leverage, and get back ranked recommendations without requiring the user to ask for discovery explicitly.
- The plugin should convert one free-form problem description into structured delegation opportunities.
- Discovery should produce stronger candidates by combining prompt understanding, richer query expansion, and better ranking evidence.
- The system should remain deterministic, inspectable, and cheap enough to run early in a workflow.

### Non-goals

- No fully autonomous background delegation outside Codex tool invocation.
- No opaque agent selection that hides why a candidate was chosen.
- No dependence on private embeddings, new external services, or a separate knowledge graph database.
- No attempt to replace the canonical HOL Registry skill or the full broker MCP surface.

### Research findings

#### 1. Codex plugin runtime constraint

This plugin cannot proactively interrupt Codex. It can only influence behavior through:

- MCP server instructions
- skill guidance
- tool contracts
- tool outputs that are useful enough to be invoked early

That means the “magic” must come from making delegation opportunity detection explicit and low-friction.

#### 2. The current wrapper is weaker than existing broker orchestration

`hashnet-mcp-js` already includes stronger delegation patterns:

- `hol.delegate.suggest`
- `workflow.delegate`

Those flows combine multiple broker search surfaces and are explicitly positioned as the default delegation path. The Codex wrapper currently uses a thinner version of that behavior and loses useful orchestration detail.

#### 3. The current ranking model is too shallow

The current ranking model boosts:

- trust
- verification
- availability
- communication support
- source score
- protocol type

It does not model:

- why this task likely needs delegation
- what kind of specialist is needed
- which search query variant produced the candidate
- whether the same candidate appeared across multiple independent retrieval strategies
- what delegation mode is appropriate for the situation

#### 4. “Knowledge graph” is only useful if it is lightweight and operational

For this plugin, a practical knowledge graph means a structured task graph derived from the current problem statement:

- intent nodes: debug, implement, review, verify, document, analyze
- surface nodes: backend, frontend, infra, protocol, MCP, SDK, API
- artifact nodes: tests, docs, rollout, ranking, search, routing
- opportunity edges: “this problem likely benefits from a research agent”, “this task likely needs an MCP server”, “this stage benefits from a verifier”

This graph should be derived in-process from the task text and immediately turned into broker search plans. It should not require a new storage system.

### User stories

#### Primary

- As a Codex user solving a complex problem, I want the plugin to identify where specialist help would matter without me manually asking for discovery.
- As a Codex user, I want to see why a specific agent was recommended for a specific subtask.
- As a Codex user, I want a bounded next action, not a long undifferentiated list of agents.

#### Secondary

- As a plugin developer, I want delegation planning to be deterministic and testable.
- As a broker operator, I want ranking changes to stay transparent and debuggable.

### Product requirements

#### Requirement 1: Problem-to-opportunity planning

The plugin must accept a single free-form problem statement and turn it into structured delegation opportunities.

Each opportunity should include:

- stable identifier
- short title
- why delegation may help
- recommended delegation mode
- recommended agent type
- recommended search query
- derived filters when possible

#### Requirement 2: Multi-query discovery

Discovery must use more than the literal user text when useful.

For each task, the plugin should derive a small query plan:

- direct query
- intent-refined query
- role or protocol-refined query

The search plan must stay bounded to avoid excessive latency.

#### Requirement 3: Evidence-based ranking

Ranking must consider:

- trust and verification
- communication support
- availability
- protocol fit
- source score
- cross-query coverage
- cross-source coverage
- role and intent fit

The output must remain inspectable.

#### Requirement 4: Native Codex workflow

The plugin must expose a first-class tool for proactive delegation planning and update the skill/instructions so Codex uses it early for medium or large tasks.

#### Requirement 5: Backward compatibility

Existing tools must continue to work:

- `registryBroker.findAgents`
- `registryBroker.summonAgent`
- `registryBroker.sessionHistory`

They should become smarter when task context is present.

### Proposed solution

#### 1. Add a new MCP tool: `registryBroker.delegate`

Purpose:

- analyze the current problem
- generate delegation opportunities
- run bounded discovery for each opportunity
- return a ranked shortlist with clear reasons

Input shape:

- `task`: required free-form problem statement
- `context`: optional additional context or current stage
- `limit`: max candidates per opportunity
- optional filters mirroring the existing search tools

Output shape:

- task summary
- inferred intents
- inferred surfaces and artifacts
- opportunity list
- ranked candidates per opportunity
- recommended next tool calls

#### 2. Introduce an in-process task graph

Create a new planning module that extracts:

- intents
- surfaces
- artifacts
- protocols
- delegation stage

This becomes the basis for both the new planning tool and smarter query expansion in existing tools.

#### 3. Upgrade discovery orchestration

Replace single-query discovery with bounded multi-query orchestration.

For each opportunity:

- run agentic search
- run vector search
- run keyword search
- merge candidates
- track which query variants and sources matched each candidate

#### 4. Upgrade ranking

Candidates should receive additional boosts for:

- appearing across more than one retrieval strategy
- matching the inferred task role
- matching the inferred protocol or server type

Candidates should be penalized for:

- missing communication support
- weak protocol fit for the opportunity

#### 5. Tighten Codex instructions

Update:

- MCP server instructions
- plugin README
- plugin skill guidance

Codex should be told to call `registryBroker.delegate` early when:

- the task is complex
- a subtask is bounded
- external specialist knowledge could unblock progress

### UX principles

- Delegation should feel suggested, not forced.
- The output must explain why an agent is a fit.
- The plugin should return “use local reasoning first” when no clear delegation opportunity exists.
- Suggestions must be bounded and actionable.

### Success metrics

#### Product

- More tasks surface at least one reasonable delegation opportunity from a single free-form problem statement.
- Fewer prompts require the user to explicitly ask for “find agents”.
- Suggested candidates are easier to trust because the reasoning is visible.

#### Technical

- Unit tests cover task planning, query expansion, and evidence-aware ranking.
- MCP tests cover the new planning tool and backward-compatible `findAgents` and `summonAgent` behavior.
- Local broker E2E covers planning plus at least one real summon flow.

### Risks

#### Risk 1: Over-matching

The planner may infer too many delegation opportunities and create noisy outputs.

Mitigation:

- cap the number of opportunities
- keep query plans small
- only surface opportunities above a minimum confidence

#### Risk 2: Latency regression

Multi-query discovery can increase broker round trips.

Mitigation:

- bound query count
- parallelize searches
- reuse the same orchestration path across tools

#### Risk 3: Prompt-shaping brittleness

Pure keyword heuristics can be shallow.

Mitigation:

- keep the planner transparent and test-driven
- model explicit task facets rather than pretending to have deep semantic certainty

### Rollout plan

#### Phase 1

- Add planner module
- Add `registryBroker.delegate`
- Update README and skill guidance
- Add tests and local E2E coverage

#### Phase 2

- Make `findAgents` use planner-derived queries when `task` is present
- Make `summonAgent` use planner-derived search plans when `uaid` is not provided

#### Phase 3

- Tune scoring and opportunity generation based on real broker results
- Consider richer artifact and protocol metadata if broker-side records support it
