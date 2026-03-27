# Registry Broker Codex Plugin

[![CI](https://github.com/hashgraph-online/registry-broker-codex-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/hashgraph-online/registry-broker-codex-plugin/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0f766e.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Registry%20Broker-0f766e.svg)](https://github.com/hashgraph-online/registry-broker-codex-plugin)

Codex plugin and MCP server for discovering, ranking, and summoning Registry Broker specialists without leaving Codex.

![Summon workflow](./assets/screenshot-summon.png)

## Why this plugin exists

`hashnet-mcp-js` already exposes the full Registry Broker surface. This plugin is the narrow, Codex-native layer on top:

- fewer tools
- stronger delegation defaults
- clearer ranking and fallback behavior
- session recall when the exact delegated conversation matters

The goal is not to mirror the entire broker API. The goal is to make broker delegation feel like a natural part of Codex workflow.

## Core tools

- `registryBroker.findAgents`: shortlist and rank likely specialists for a task.
- `registryBroker.summonAgent`: delegate a bounded subtask through the broker with `best-match`, `fallback`, or `parallel` routing.
- `registryBroker.sessionHistory`: recover the exact broker conversation for follow-up work.
- `registryBroker.health`: confirm broker connectivity, protocol metadata, and plugin runtime status.

![Shortlist workflow](./assets/screenshot-shortlist.png)

## What makes it feel native

- The default MCP server name is short and descriptive: `registryBroker`.
- The skill guidance is summon-first, not control-panel-first.
- Explicit UAID routing is supported when a workflow already knows the agent to message.
- Summon results return enough structured payload to integrate the broker answer back into Codex cleanly.

## Installation

The plugin ships as a standalone Codex plugin repo:

- manifest: `.codex-plugin/plugin.json`
- MCP wiring: `.mcp.json`
- broker guidance: `skills/registry-broker-orchestrator/SKILL.md`

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
REGISTRY_BROKER_E2E_UAID='uaid:aid:target-agent' \
REGISTRY_BROKER_E2E_MESSAGE='your probe message' \
REGISTRY_BROKER_E2E_EXPECT='expected response substring' \
pnpm run e2e:broker
```

This smoke test is intentionally generic. It requires a broker environment and target agent you already control; private deployment details are not documented in this public repository.

## Implementation notes

- `src/mcp.ts`: tool definitions, server instructions, and summon orchestration.
- `src/broker.ts`: thin broker client adapter over `@hashgraphonline/standards-sdk`.
- `src/config.ts`: runtime config and short MCP naming defaults.
- `scripts/e2e-local-broker.ts`: generic broker-backed smoke verification.

## Discoverability

The repo is tagged for both broad MCP/Codex discovery and Registry Broker specificity. Package metadata and plugin manifest keywords are aligned with that same topic strategy so GitHub and Codex surfaces describe the plugin consistently.
