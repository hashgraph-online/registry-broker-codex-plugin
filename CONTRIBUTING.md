# Contributing to HOL Registry Broker Codex Plugin

Thank you for your interest in contributing to the HOL Registry Broker Codex Plugin.

We welcome bug reports, feature requests, documentation improvements, and code contributions that improve how Registry Broker delegation feels inside Codex.

## Bug reports

Bug reports are accepted through the [issue tracker](https://github.com/hashgraph-online/registry-broker-codex-plugin/issues).

Before opening a new bug report:

1. Search existing issues to avoid duplicates.
2. Verify the behavior against the latest published branch or release.
3. Include a minimal reproduction if you can isolate one.

Please include:

- a short descriptive title
- the expected behavior and the actual behavior
- relevant environment details
- stack traces or screenshots when useful
- a small reproduction or exact command sequence when possible

## Feature requests

Feature requests are also tracked through the [issue tracker](https://github.com/hashgraph-online/registry-broker-codex-plugin/issues).

Before implementing a new feature:

1. Search for an existing request.
2. Open an issue for discussion unless the change is very small.
3. Explain why the change belongs in this plugin instead of the canonical HOL Registry skill, CLI, or broader broker MCP surface.

## Code contributions

Code contributions should come through pull requests.

Please keep the following in mind:

- This repository is the narrow Codex wrapper, not the primary HOL Registry skill or CLI distribution.
- New behavior should preserve the summon-first, broker-native orchestration model.
- All code changes must include tests that cover the new behavior or regression.
- Public docs must not expose private broker deployment details.

## Development setup

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm test
```

For live broker validation, use the generic smoke harness:

```bash
pnpm run e2e:broker
```

Provide the required broker environment variables in your shell before running that command.

## Pull request process

### Branch naming

Use branch names that clearly describe the work:

- `feat/short-description`
- `fix/short-description`
- `docs/short-description`
- `chore/short-description`
- `refactor/short-description`
- `test/short-description`

### Commit messages

We follow Conventional Commits:

- `feat:` for new functionality
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for refactors
- `test:` for test-only changes
- `chore:` for maintenance

### Pull request readiness

Before opening or updating a pull request, make sure:

- tests cover the new behavior
- `pnpm run build` passes
- `pnpm run typecheck` passes
- `pnpm run lint` passes
- `pnpm test` passes
- public docs reflect the final user-facing behavior

### DCO

HOL repositories may require a DCO sign-off on commits. If your contribution flow uses local git, sign commits with:

```bash
git commit -s -m "your commit message"
```

## Code of conduct

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md) before participating in this repository.

## Contact

- Website: [hol.org](https://hol.org)
- Support: support@hashgraphonline.com
