# Delegation Consumption Technical Todo

## Goal

Update the Registry Broker plugin so it fully consumes the broker-native delegation outcome model instead of behaving like a generic search wrapper.

## Step 1. Audit the current plugin routing flow

Files:

- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/src/mcp.ts`
- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/src/broker.ts`
- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/src/ranking.ts`

Tasks:

- confirm where `delegate`, `findAgents`, and `summonAgent` are chosen
- identify any remaining local heuristics that override broker recommendation
- confirm where workspace context is gathered or omitted

## Step 2. Make delegate the default path for task-shaped work

Files:

- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/src/mcp.ts`
- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/skills/registry-broker-orchestrator/SKILL.md`

Tasks:

- update tool guidance so medium and large tasks route through `registryBroker.delegate` first
- keep direct-UAID workflows intact when the user already knows the target
- ensure example prompts cover:
  - code help
  - business plan or GTM
  - landing page or UX
  - research and competitive analysis

## Step 3. Standardize workspace context forwarding

Files:

- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/src/mcp.ts`
- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/src/broker.ts`

Tasks:

- ensure `workspace` is forwarded for:
  - `delegate`
  - any summon flow that originates from a task
- keep the payload compact and bounded
- avoid sending noisy or redundant workspace fields

## Step 4. Treat broker recommendation as authoritative

Files:

- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/src/mcp.ts`
- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/src/ranking.ts`

Tasks:

- if broker returns `delegate-now`, use that recommendation directly
- if broker returns `review-shortlist`, present shortlist behavior instead of collapsing to one candidate
- if broker returns `handle-locally`, avoid pushing users into unnecessary delegation
- keep local ranking only as a narrow fallback when broker recommendation is absent or malformed

## Step 5. Improve tool summaries for real use-cases

Files:

- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/src/mcp.ts`

Tasks:

- surface `Recommendation: ...` clearly in tool output
- include the recommended candidate label when present
- preserve broker `reason`
- keep summaries short enough for Codex to scan quickly

## Step 6. Add plugin-level behavior coverage

Files:

- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/__tests__/mcp.test.ts`
- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/__tests__/delegation-planner.test.ts`

Tasks:

- add expectations for:
  - code task -> broker recommendation visible
  - business-plan task -> `delegate-now`
  - design task -> `delegate-now`
- assert workspace forwarding remains intact
- assert plugin does not overwrite a broker recommendation with conflicting local logic

## Step 7. Expand the live plugin E2E harness

Files:

- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/scripts/e2e-local-broker.ts`

Tasks:

- keep the existing ping-agent verification
- add read-only delegation-plan checks for:
  - coding task
  - business-plan task
  - design task
- fail the script if the broker recommendation is missing or the opportunity IDs drift unexpectedly

## Step 8. Update public plugin docs

Files:

- `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin/README.md`

Tasks:

- explain that the plugin is now broker-recommendation-first
- add example prompts for:
  - fixing code
  - writing a business plan
  - designing a landing page
  - drafting launch messaging
- keep the plugin described as thin on top of the broker, not as its own ranking engine

## Step 9. Verify against the real local broker

Commands:

- in `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker`:
  - `docker compose restart registry-broker`
- in `/Users/michaelkantor/CascadeProjects/hashgraph-online/registry-broker-codex-plugin`:
  - `pnpm run lint`
  - `pnpm run typecheck`
  - `pnpm test`
  - `pnpm run e2e:broker`

Verification targets:

- code ask returns a usable broker recommendation through the plugin
- business-plan ask returns `delegate-now`
- design ask returns `delegate-now`

## Step 10. Verify against production

Tasks:

- point the plugin at `https://hol.org/registry/api/v1`
- run the plugin consumer path for:
  - coding task
  - business-plan task
  - design task
- confirm the plugin output reflects the live broker recommendation

## Definition of Done

- plugin is delegate-first for task-shaped work
- plugin sends bounded workspace context
- broker recommendation drives plugin behavior
- use-cases like coding, strategy, and design are visible through plugin output without plugin-side task hardcoding
- local and production live verification both pass
