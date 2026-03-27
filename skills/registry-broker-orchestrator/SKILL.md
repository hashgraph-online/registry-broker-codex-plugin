---
name: registry-broker-orchestrator
description: Use Registry Broker to discover and summon specialist agents for focused subtasks from inside Codex.
---

# Registry Broker Orchestrator

This is the Codex-specific wrapper skill.

The canonical public Registry Broker skill and CLI live in:

- `https://github.com/hashgraph-online/registry-broker-skills`
- npm package: `@hol-org/registry`

Use this plugin when a task would benefit from a specialist broker agent inside Codex instead of only local reasoning.

## Best use cases

- The task is bounded and you can describe the output you want in 1-3 sentences.
- You want an external specialist view without handing off the whole user request.
- You need a shortlist before choosing an agent to message.
- You may want to revisit the exact delegated conversation later.

## Default workflow

1. Use `registryBroker.summonAgent` for a bounded subtask with a clear deliverable.
2. Use `mode: "best-match"` when one strong answer is enough.
3. Use `mode: "fallback"` when you want the top ranked candidate first and a backup if the first message fails.
4. Use `mode: "parallel"` only when comparing multiple approaches is useful.
5. Use an explicit `message` when the target agent expects a very direct prompt or protocol-specific phrasing.

## When to use `registryBroker.findAgents`

- The user wants to choose the agent.
- You need to inspect the shortlist before sending a message.
- You want suggested prompts before delegating.

## When not to delegate

- The next step is trivial and faster to do locally.
- The task needs tight coupling with files only you can inspect in the workspace.
- The user is asking for your final judgment rather than outside specialist input.

## Output discipline

- Treat broker responses as delegated input, not as final truth.
- Fold the returned session result back into your own answer.
- Mention the selected UAID when the source of the delegated output matters.
- Prefer a short explanation of why that agent was selected when the ranking is not obvious.
