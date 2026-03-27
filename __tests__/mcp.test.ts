import { describe, expect, it, vi } from 'vitest';
import { createToolDefinitions } from '../src/mcp';

function createService() {
  return {
    search: vi.fn().mockResolvedValue({
      hits: [
        {
          uaid: 'uaid:test-agent',
          registry: 'hashgraph-online',
          trustScore: 96,
          verified: true,
          online: true,
          profile: {
            display_name: 'Test Agent',
            alias: 'test-agent',
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 5,
    }),
    vectorSearch: vi.fn().mockResolvedValue({
      hits: [
        {
          agent: {
            uaid: 'uaid:test-agent',
            registry: 'hashgraph-online',
            trustScore: 96,
            verified: true,
            communicationSupported: true,
            profile: {
              display_name: 'Test Agent',
            },
          },
          score: 0.9,
        },
      ],
    }),
    agenticSearch: vi.fn().mockResolvedValue({
      hits: [
        {
          agent: {
            uaid: 'uaid:test-agent',
            registry: 'hashgraph-online',
            trustScore: 96,
            verified: true,
            communicationSupported: true,
            profile: {
              display_name: 'Test Agent',
            },
          },
          score: 0.98,
        },
      ],
    }),
    sendMessage: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      message: 'delegated answer',
    }),
    getHistory: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      history: [],
    }),
    stats: vi.fn().mockResolvedValue({ totalAgents: 10 }),
    listProtocols: vi.fn().mockResolvedValue({ protocols: ['a2a', 'mcp'] }),
    resolveUaid: vi.fn().mockResolvedValue({}),
  };
}

describe('registry broker mcp tools', () => {
  it('returns ranked candidates from findAgents', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.findAgents',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      query: 'test agent',
      task: 'Find a testing specialist.',
      limit: 3,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Test Agent');
    expect(service.agenticSearch).toHaveBeenCalledOnce();
    expect(service.search).toHaveBeenCalledOnce();
  });

  it('sends a message through summonAgent', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.summonAgent',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      task: 'Ask for a delegated answer.',
      query: 'test agent',
      mode: 'best-match',
      limit: 1,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Messages attempted: 1, succeeded: 1');
    expect(service.sendMessage).toHaveBeenCalledOnce();
  });

  it('supports direct uaid summoning without broker discovery', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.summonAgent',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      task: 'Ask the known agent directly.',
      uaid: 'uaid:known-agent',
      message: 'ping',
      mode: 'best-match',
      limit: 1,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('uaid:known-agent');
    expect(service.agenticSearch).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
    expect(service.sendMessage).toHaveBeenCalledWith({
      uaid: 'uaid:known-agent',
      message: 'ping',
      streaming: undefined,
    });
  });
});
