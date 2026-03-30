# Broker Plugin Todo

- [x] Add a shared delegation-brief contract that supports deliverable, constraints, must-include items, and acceptance criteria.
- [x] Split shared tool schemas out of `src/mcp.ts` so the new contract does not keep inflating the MCP handler file.
- [x] Add a dry-run mode to `registryBroker.summonAgent` that resolves the same candidate and message without sending.
- [x] Add explicit next-action payloads and summon-ready hints to `delegate`, `findAgents`, and `summonAgent`.
- [x] Add session-history summarization so follow-up work can use the latest broker state without parsing raw history first.
- [x] Expand unit coverage for structured briefs, dry-run dispatch, next-action payloads, and history summaries.
- [x] Extend the broker-backed E2E script to validate the dry-run path and the richer tool outputs.
- [x] Update the README and skill guidance to document the new structured delegation flow.
- [x] Run `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, and `pnpm run build`, then close every completed task in this file.
