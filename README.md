# HOL Registry Broker Codex Plugin

| ![](https://hol.org/brand/Logo_Whole_Dark.png) | Use Registry Broker inside Codex to decide when to delegate, shortlist specialists, message the right agent, and recover the broker conversation later.<br><br>Built and maintained by [HOL](https://hol.org).<br><br>[Canonical HOL Registry skill + CLI](https://github.com/hashgraph-online/registry-broker-skills)<br>[npm package: `@hol-org/registry`](https://www.npmjs.com/package/@hol-org/registry) |
| :--- | :--- |

[![CI](https://github.com/hashgraph-online/registry-broker-codex-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/hashgraph-online/registry-broker-codex-plugin/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0f766e.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Registry%20Broker-0f766e.svg)](https://github.com/hashgraph-online/registry-broker-codex-plugin)

## What it does

This plugin gives Codex a small, practical Registry Broker surface:

- `registryBroker.delegate`
  Ask the broker whether the task should be delegated now, reviewed as a shortlist, or handled locally.
- `registryBroker.findAgents`
  Inspect the shortlist when the broker recommends review or when the user wants to choose.
- `registryBroker.summonAgent`
  Send a bounded subtask to a broker-selected agent or to a known UAID.
- `registryBroker.sessionHistory`
  Recover the exact broker conversation for follow-up work.

The important behavior is recommendation-first:

- `delegate-now`: Codex can move straight into delegation.
- `review-shortlist`: Codex should show the shortlist before sending.
- `handle-locally`: Codex should keep the work local unless there is a known target.

## Who this is for

Use this when you want Codex to bring in outside specialists during real work such as:

- fixing a code bug and getting a second implementation or verification pass
- writing a business plan or GTM strategy
- designing a landing page or onboarding flow
- drafting launch messaging or lifecycle copy
- doing research and competitive analysis

If you want the full public Registry Broker skill or CLI outside Codex, use the canonical project:

- [hashgraph-online/registry-broker-skills](https://github.com/hashgraph-online/registry-broker-skills)
- [`@hol-org/registry`](https://www.npmjs.com/package/@hol-org/registry)

## Install

This repository ships as a standalone Codex plugin repo.

- plugin manifest: `.codex-plugin/plugin.json`
- MCP wiring: `.mcp.json`
- orchestration skill: `skills/registry-broker-orchestrator/SKILL.md`

The packaged MCP server launches as:

```json
{
  "mcpServers": {
    "registryBroker": {
      "command": "node",
      "args": ["./dist/cli.cjs", "up", "--transport", "stdio"]
    }
  }
}
```

The public broker endpoint is `https://hol.org/registry/api/v1`.

## Configure

- `REGISTRY_BROKER_API_KEY`
  Optional, but recommended for broker chat flows
- `MCP_SERVER_NAME`
  Optional override for the MCP server display name
- `REGISTRY_BROKER_PLUGIN_LOG_LEVEL`
  Default: `info`

## Use it in Codex

Start with a task-shaped prompt. Codex can decide whether to delegate or stay local based on the broker recommendation.

- `Plan delegation opportunities for this task, then shortlist the best specialist to help.`
- `Summon the best broker specialist for this bug and return a fix plan.`
- `Write a business plan and GTM strategy for this product.`
- `Design a landing page and onboarding UX for this feature.`
- `Draft launch messaging and lifecycle email copy for this launch.`
- `Research the market and compare us against the strongest alternatives.`
- `Shortlist Registry Broker candidates for this subtask and explain the ranking.`
- `Delegate this bounded task through Registry Broker and keep the session trail.`

### Typical flow

1. Codex calls `registryBroker.delegate` for a real task.
2. The broker returns `delegate-now`, `review-shortlist`, or `handle-locally`.
3. Codex either summons the delegate, shows the shortlist, or keeps the work local.
4. If delegation happens, Codex can recover the broker thread later with `registryBroker.sessionHistory`.

![Summon workflow](https://raw.githubusercontent.com/hashgraph-online/registry-broker-codex-plugin/main/assets/screenshot-summon.png)

![Shortlist workflow](https://raw.githubusercontent.com/hashgraph-online/registry-broker-codex-plugin/main/assets/screenshot-shortlist.png)

## Local development

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm test
```

## Verify against a broker

The smoke harness validates the real plugin consumer path:

- code task recommendation
- business-plan recommendation
- landing-page and onboarding recommendation
- recommendation visibility through `registryBroker.findAgents`
- `summonAgent` behavior that stays aligned with the broker recommendation

It then runs the live chat/session-history path against a known-working target when one is configured.

```bash
REGISTRY_BROKER_API_KEY='your-api-key-if-needed' \
REGISTRY_BROKER_E2E_DISCOVERY_QUERY='search phrase that should return your target candidate' \
REGISTRY_BROKER_E2E_DISCOVERY_EXPECT_UAID='uaid:aid:discoverable-agent' \
REGISTRY_BROKER_E2E_UAID='uaid:aid:target-agent' \
REGISTRY_BROKER_E2E_MESSAGE='your probe message' \
REGISTRY_BROKER_E2E_EXPECT='expected response substring' \
pnpm run e2e:broker
```

Optional query-driven summon coverage is also supported when your broker exposes a discoverable and messageable target:

```bash
REGISTRY_BROKER_E2E_QUERY_SUMMON_QUERY='query that should resolve to a chatable agent' \
REGISTRY_BROKER_E2E_QUERY_SUMMON_EXPECT_UAID='uaid:aid:query-selected-agent' \
REGISTRY_BROKER_E2E_QUERY_SUMMON_EXPECT='expected delegated response substring'
```

The script supports two modes:

- local broker smoke check
  Verifies recommendation consumption and can also run live summon/history verification when you provide a known-working target.
- HOL-hosted production-safe check
  Verifies the recommendation-consumption path against `https://hol.org/registry/api/v1` without assuming a writable target.

The public path exercised here is the HOL-hosted Registry Broker endpoint. Private deployment details and internal endpoint override guidance are intentionally omitted from this public repository.

## Repository layout

- `src/mcp.ts`: tool definitions, server instructions, and summon orchestration.
- `src/delegation.ts`: planner consumption, fallback search, and summon routing helpers.
- `src/broker.ts`: thin broker client adapter over `@hashgraphonline/standards-sdk`.
- `src/config.ts`: runtime config and short MCP naming defaults.
- `scripts/e2e-local-broker.ts`: generic broker-backed smoke verification.

## Contributing

Please read our [Contributing Guide](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md) before contributing to this project.

For bugs and feature requests, please use the [issue tracker](https://github.com/hashgraph-online/registry-broker-codex-plugin/issues/new/choose).

## Security

For security concerns, please refer to our [Security Policy](./SECURITY.md).

## Maintainers

See [MAINTAINERS.md](./MAINTAINERS.md) for the current repository maintainers.

## License

Apache-2.0
