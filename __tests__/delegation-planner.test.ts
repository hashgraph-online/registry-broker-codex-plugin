import { describe, expect, it, vi } from 'vitest';
import { createToolDefinitions } from '../src/mcp';

describe('registryBroker.planDelegation tool', () => {
  it('forwards delegation planning to the broker service', async () => {
    const planDelegation = vi.fn().mockResolvedValue({
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
      planDelegation,
      sendMessage: vi.fn(),
      getHistory: vi.fn(),
      stats: vi.fn(),
      listProtocols: vi.fn(),
      resolveUaid: vi.fn(),
    }).find((entry) => entry.name === 'registryBroker.planDelegation');

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

    expect(planDelegation).toHaveBeenCalledWith({
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
    expect(text).toContain('research-specialist');
  });
});
