# HOL Registry Broker Codex Plugin

| ![](https://hol.org/brand/Logo_Whole_Dark.png) | A Codex plugin wrapper that makes Registry Broker delegation feel native inside Codex.<br><br>Built and maintained by [HOL](https://hol.org). This plugin sits on top of the canonical HOL Registry skill and CLI so Codex can plan delegation opportunities, shortlist specialists, summon a delegate, and recover broker session history without leaving the working loop.<br><br>[Canonical HOL Registry skill + CLI](https://github.com/hashgraph-online/registry-broker-skills)<br>[npm package: `@hol-org/registry`](https://www.npmjs.com/package/@hol-org/registry) |
| :--- | :--- |

[![CI](https://github.com/hashgraph-online/registry-broker-codex-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/hashgraph-online/registry-broker-codex-plugin/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0f766e.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Registry%20Broker-0f766e.svg)](https://github.com/hashgraph-online/registry-broker-codex-plugin)

## Canonical surfaces

The canonical public Registry Broker skill and CLI already live in:

- [hashgraph-online/registry-broker-skills](https://github.com/hashgraph-online/registry-broker-skills)
- [`@hol-org/registry`](https://www.npmjs.com/package/@hol-org/registry)

This repository is not the primary skill or CLI distribution. It is the Codex plugin wrapper that adds a summon-first MCP surface tailored to Codex workflows.

## Why this plugin exists

`registry-broker-skills` already provides the broad public skill and CLI surface, and `hashnet-mcp-js` exposes the full broker MCP surface. This plugin is the narrow Codex-native layer on top:

- fewer tools
- stronger delegation defaults
- clearer ranking and fallback behavior
- session recall when the exact delegated conversation matters

The goal is not to mirror the entire broker API or replace the canonical HOL Registry package. The goal is to make broker delegation feel like a natural part of Codex workflow.

## Core tools

- `registryBroker.planDelegation`: turn a free-form task into ranked broker delegation opportunities.
- `registryBroker.findAgents`: shortlist and rank likely specialists for a task.
- `registryBroker.summonAgent`: delegate a bounded subtask through the broker with `best-match`, `fallback`, or `parallel` routing.
- `registryBroker.sessionHistory`: recover the exact broker conversation for follow-up work.
- `registryBroker.health`: confirm broker connectivity, protocol metadata, and plugin runtime status.

![Summon workflow](https://raw.githubusercontent.com/hashgraph-online/registry-broker-codex-plugin/main/assets/screenshot-summon.png)

## What makes it feel native

- The default MCP server name is short and descriptive: `registryBroker`.
- The skill guidance is summon-first, not control-panel-first.
- Broker-native `planDelegation` is the default path for task-shaped work.
- Explicit UAID routing is supported when a workflow already knows the agent to message.
- Summon results return enough structured payload to integrate the broker answer back into Codex cleanly.

![Shortlist workflow](https://raw.githubusercontent.com/hashgraph-online/registry-broker-codex-plugin/main/assets/screenshot-shortlist.png)

## Installation

The plugin ships as a standalone Codex plugin repo:

- manifest: `.codex-plugin/plugin.json`
- MCP wiring: `.mcp.json`
- broker guidance: `skills/registry-broker-orchestrator/SKILL.md`

If you want the full public Registry Broker skill and CLI experience outside this plugin wrapper, use `@hol-org/registry` from the canonical repo above.

The MCP server launches from the packaged CLI:

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

## Environment

- `REGISTRY_BROKER_API_URL`
  Default: `https://hol.org/registry/api/v1`
- `REGISTRY_BROKER_API_KEY`
  Optional for public discovery, recommended for broker chat flows
- `MCP_SERVER_NAME`
  Optional override for the MCP server display name
- `REGISTRY_BROKER_PLUGIN_LOG_LEVEL`
  Default: `info`

## Example prompts

- `Plan delegation opportunities for this task, then shortlist the best specialist to help.`
- `Summon the best broker specialist for this bug and return a fix plan.`
- `Shortlist Registry Broker candidates for this subtask and explain the ranking.`
- `Delegate this bounded task through Registry Broker and keep the session trail.`

## Local development

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm test
```

## Broker-backed smoke test

```bash
REGISTRY_BROKER_API_URL='https://your-broker.example/api/v1' \
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

This smoke test is intentionally generic. It requires a broker environment plus:

- one discoverable candidate for `registryBroker.findAgents`
- one known-working target for `registryBroker.summonAgent` and `registryBroker.sessionHistory`

Private deployment details are not documented in this public repository.

## Implementation notes

- `src/mcp.ts`: tool definitions, server instructions, and summon orchestration.
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
