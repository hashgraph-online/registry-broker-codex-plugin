## Agentic Discovery Implementation Backlog

### Goal

Make `registry-broker-codex-plugin` feel proactive by turning a free-form problem statement into structured delegation opportunities, stronger discovery queries, and evidence-aware ranking.

### Research checkpoints already completed

- Current MCP wrapper is manual and query-driven.
- `hashnet-mcp-js` already contains the richer delegation posture that should inform this wrapper.
- Codex plugin runtime cannot self-trigger outside tool invocation, so the solution must live in instructions, tool design, and tool outputs.

### Implementation tasks

#### 1. Add planning module

- Create `src/delegation-planner.ts`.
- Define planner input and output types.
- Extract:
  - intent categories
  - surface categories
  - artifact hints
  - protocol hints
  - delegation stage
- Generate bounded opportunity objects with:
  - `id`
  - `title`
  - `reason`
  - `searchQuery`
  - `type`
  - `suggestedMode`
  - optional filters

#### 2. Add opportunity-aware search orchestration

- Create `src/discovery-orchestrator.ts`.
- Implement bounded multi-query orchestration over:
  - agentic search
  - vector search
  - keyword search
- Track evidence:
  - matched query variants
  - matched sources
  - matched opportunity ids

#### 3. Upgrade ranking aggregation

- Update `src/ranking.ts`.
- Aggregate duplicate candidates across results instead of dropping later matches.
- Add ranking boosts for:
  - cross-query coverage
  - cross-source coverage
  - role fit
  - protocol fit
- Keep existing trust, verification, availability, and communication support signals.

#### 4. Add new MCP tool

- Add `registryBroker.delegate` in `src/mcp.ts`.
- Keep the output inspectable:
  - summary
  - opportunities
  - candidates per opportunity
  - recommended next calls

#### 5. Make existing tools smarter

- Update `registryBroker.findAgents` to use planner-derived queries when `task` is present.
- Update `registryBroker.summonAgent` to use planner-derived discovery when `uaid` is not provided.
- Preserve direct UAID routing unchanged.

#### 6. Update human-facing guidance

- Update `skills/registry-broker-orchestrator/SKILL.md`.
- Update `README.md`.
- Update MCP instructions in `src/mcp.ts`.
- The guidance should tell Codex to use `registryBroker.delegate` early for medium or large tasks.

### Test plan

#### Unit tests

- Add `__tests__/delegation-planner.test.ts`.
- Cover:
  - debug-heavy prompts
  - docs-heavy prompts
  - MCP/server-heavy prompts
  - mixed research plus implementation prompts
  - low-signal prompts that should not overproduce opportunities

#### MCP tests

- Extend `__tests__/mcp.test.ts`.
- Cover:
  - `registryBroker.delegate`
  - `findAgents` with planner-driven task context
  - `summonAgent` with planner-driven candidate discovery

#### Broker E2E

- Extend `scripts/e2e-local-broker.ts`.
- Validate:
  - `registryBroker.delegate`
  - `registryBroker.findAgents`
  - `registryBroker.summonAgent`
  - `registryBroker.sessionHistory`

### Verification commands

Run from `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin`:

- `pnpm test`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm run e2e:broker`

### Follow-on ideas after the first shippable version

- Add broker-side metadata fields that make role fit stronger.
- Add protocol-specific routing confidence to planner outputs.
- Add a planner confidence score to suppress weak recommendations.
- Add opt-in debug payloads for ranking evidence to help tune production behavior.
