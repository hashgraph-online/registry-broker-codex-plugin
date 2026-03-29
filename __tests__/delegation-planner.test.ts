import { describe, expect, it, vi } from 'vitest';
import { createToolDefinitions } from '../src/mcp';

describe('registryBroker.delegate tool', () => {
  it('forwards delegation planning to the broker service', async () => {
    const delegate = vi.fn().mockResolvedValue({
      shouldDelegate: true,
      recommendation: {
        action: 'delegate-now',
      },
      intents: ['research', 'implementation'],
      opportunities: [
        {
          id: 'research-specialist',
          title: 'Research the strongest approach',
          candidates: [{ uaid: 'uaid:test-agent', label: 'Test Agent' }],
        },
      ],
    });
    const tool = createToolDefinitions({
      search: vi.fn(),
      vectorSearch: vi.fn(),
      agenticSearch: vi.fn(),
      delegate,
      sendMessage: vi.fn(),
      getHistory: vi.fn(),
      resolveUaid: vi.fn(),
    }).find((entry) => entry.name === 'registryBroker.delegate');

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      task: 'Research and implement a proactive discovery feature.',
      context: 'Prefer candidates that can validate the work too.',
      limit: 2,
      protocols: ['mcp'],
      registries: ['hashgraph-online'],
      workspace: {
        openFiles: ['src/plugin/mcp.ts'],
        modifiedFiles: ['src/broker.ts'],
        errors: ['No adapter found'],
        languages: ['typescript'],
      },
    });

    expect(delegate).toHaveBeenCalledWith({
      task: 'Research and implement a proactive discovery feature.',
      context: 'Prefer candidates that can validate the work too.',
      workspace: {
        openFiles: ['src/plugin/mcp.ts'],
        modifiedFiles: ['src/broker.ts'],
        errors: ['No adapter found'],
        languages: ['typescript'],
      },
      limit: 2,
      filter: {
        protocols: ['mcp'],
        registries: ['hashgraph-online'],
      },
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Delegation opportunities');
    expect(text).toContain('Recommendation: delegate-now');
    expect(text).toContain('Recommended candidate: Test Agent');
    expect(text).toContain('Selected opportunity: research-specialist');
    expect(text).toContain('research-specialist');
  });

  it('forwards workspace context for task-shaped planning', async () => {
    const delegate = vi.fn().mockResolvedValue({
      recommendation: {
        action: 'delegate-now',
        opportunityId: 'implementation-specialist',
        candidate: { uaid: 'uaid:test-agent', label: 'Test Agent' },
      },
      opportunities: [
        {
          id: 'implementation-specialist',
          title: 'Implement the fix',
          candidates: [{ uaid: 'uaid:test-agent', label: 'Test Agent' }],
        },
      ],
    });
    const tool = createToolDefinitions({
      search: vi.fn(),
      vectorSearch: vi.fn(),
      agenticSearch: vi.fn(),
      delegate,
      sendMessage: vi.fn(),
      getHistory: vi.fn(),
      resolveUaid: vi.fn(),
    }).find((entry) => entry.name === 'registryBroker.delegate');

    expect(tool).toBeDefined();

    await tool!.execute({
      task: 'Fix this TypeScript plugin bug and verify the patch.',
      limit: 3,
      workspace: {
        openFiles: [
          ' src/mcp.ts ',
          'src/mcp.ts',
          'src/broker.ts',
          'src/ranking.ts',
          'src/config.ts',
          'README.md',
          'skills/registry-broker-orchestrator/SKILL.md',
          'docs/delegation-consumption-prd.md',
        ],
        commands: [' pnpm test ', 'pnpm test', 'pnpm run lint', 'pnpm run typecheck'],
        languages: [' typescript ', 'typescript', 'markdown'],
      },
    });

    expect(delegate).toHaveBeenCalledWith({
      task: 'Fix this TypeScript plugin bug and verify the patch.',
      context: undefined,
      workspace: {
        openFiles: [
          ' src/mcp.ts ',
          'src/mcp.ts',
          'src/broker.ts',
          'src/ranking.ts',
          'src/config.ts',
          'README.md',
          'skills/registry-broker-orchestrator/SKILL.md',
          'docs/delegation-consumption-prd.md',
        ],
        commands: [' pnpm test ', 'pnpm test', 'pnpm run lint', 'pnpm run typecheck'],
        languages: [' typescript ', 'typescript', 'markdown'],
      },
      limit: 3,
      filter: undefined,
    });
  });

  it.each([
    'Write a business plan and GTM strategy for this product.',
    'Design a landing page and onboarding UX for this feature.',
  ])('shows delegate-now clearly for high-leverage task "%s"', async (task) => {
    const delegate = vi.fn().mockResolvedValue({
      recommendation: {
        action: 'delegate-now',
        reason: 'A specialist delegate can add leverage here.',
        opportunityId: 'strategy-specialist',
        candidate: { uaid: 'uaid:test-agent', label: 'Test Agent' },
      },
      opportunities: [
        {
          id: 'strategy-specialist',
          title: 'Drive the next specialist step',
          candidates: [{ uaid: 'uaid:test-agent', label: 'Test Agent' }],
        },
      ],
    });
    const tool = createToolDefinitions({
      search: vi.fn(),
      vectorSearch: vi.fn(),
      agenticSearch: vi.fn(),
      delegate,
      sendMessage: vi.fn(),
      getHistory: vi.fn(),
      resolveUaid: vi.fn(),
    }).find((entry) => entry.name === 'registryBroker.delegate');

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      task,
      limit: 2,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Recommendation: delegate-now');
    expect(text).toContain('Reason: A specialist delegate can add leverage here.');
    expect(text).toContain('Recommended candidate: Test Agent');
  });
});
