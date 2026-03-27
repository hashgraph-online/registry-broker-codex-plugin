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
    planDelegation: vi.fn().mockResolvedValue({
      summary: 'Delegation plan',
      recommendation: {
        action: 'delegate-now',
        opportunityId: 'research-specialist',
        candidate: {
          uaid: 'uaid:test-agent',
          label: 'Test Agent',
        },
      },
      opportunities: [
        {
          id: 'research-specialist',
          title: 'Research the strongest approach',
          candidates: [
            {
              uaid: 'uaid:test-agent',
              label: 'Test Agent',
            },
          ],
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
    expect(service.planDelegation).toHaveBeenCalledOnce();
    expect(service.agenticSearch).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
  });

  it('uses planner-selected candidates before local ranking in findAgents', async () => {
    const service = createService();
    service.planDelegation.mockResolvedValue({
      summary: 'Delegation plan',
      recommendation: {
        action: 'delegate-now',
        opportunityId: 'implementation-specialist',
        candidate: {
          uaid: 'uaid:planned-agent',
          label: 'Planned Agent',
        },
      },
      opportunities: [
        {
          id: 'implementation-specialist',
          title: 'Implement a focused subsystem fix',
          candidates: [
            {
              uaid: 'uaid:planned-agent',
              label: 'Planned Agent',
            },
          ],
        },
      ],
    });
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
    expect(text).toContain('Planned Agent');
    expect(text).not.toContain('Test Agent');
    expect(service.planDelegation).toHaveBeenCalledOnce();
    expect(service.agenticSearch).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
  });

  it('returns delegation opportunities from planDelegation', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.planDelegation',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      task: 'Create a PRD, implement proactive discovery, and verify the plugin end to end.',
      context: 'This should feel natural inside Codex.',
      limit: 2,
      workspace: {
        openFiles: ['src/mcp.ts'],
        modifiedFiles: ['src/broker.ts'],
      },
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Delegation opportunities');
    expect(text).toContain('Recommendation: delegate-now');
    expect(text).toContain('research-specialist');
    expect(service.planDelegation).toHaveBeenCalledOnce();
  });

  it('passes canonical delegation filters to the broker planner', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.planDelegation',
    );

    expect(tool).toBeDefined();

    await tool!.execute({
      task: 'Review a TypeScript patch for correctness.',
      limit: 2,
      registries: ['openrouter'],
      adapters: ['openrouter-adapter'],
      capabilities: ['implementation'],
      protocols: ['openrouter'],
      minTrust: 80,
      verified: true,
      online: true,
      type: 'ai-agents',
      workspace: {
        modifiedFiles: ['src/routes/search.ts'],
        commands: ['pnpm run test'],
      },
    });

    expect(service.planDelegation).toHaveBeenCalledWith({
      task: 'Review a TypeScript patch for correctness.',
      context: undefined,
      workspace: {
        modifiedFiles: ['src/routes/search.ts'],
        commands: ['pnpm run test'],
      },
      limit: 2,
      filter: {
        registries: ['openrouter'],
        adapters: ['openrouter-adapter'],
        capabilities: ['implementation'],
        protocols: ['openrouter'],
        minTrust: 80,
        verifiedOnly: true,
        onlineOnly: true,
        type: 'ai-agents',
      },
    });
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
    expect(service.planDelegation).toHaveBeenCalledOnce();
    expect(service.agenticSearch).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
    expect(service.sendMessage).toHaveBeenCalledOnce();
  });

  it('uses planner-selected candidates before local ranking in summonAgent', async () => {
    const service = createService();
    service.planDelegation.mockResolvedValue({
      summary: 'Delegation plan',
      recommendation: {
        action: 'delegate-now',
        opportunityId: 'verification-specialist',
        candidate: {
          uaid: 'uaid:planned-agent',
          label: 'Planned Agent',
        },
      },
      opportunities: [
        {
          id: 'verification-specialist',
          title: 'Verify the result independently',
          candidates: [
            {
              uaid: 'uaid:planned-agent',
              label: 'Planned Agent',
            },
          ],
        },
      ],
    });
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.summonAgent',
    );

    expect(tool).toBeDefined();

    await tool!.execute({
      task: 'Ask for a delegated answer.',
      query: 'test agent',
      mode: 'best-match',
      limit: 1,
    });

    expect(service.planDelegation).toHaveBeenCalledOnce();
    expect(service.agenticSearch).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
    expect(service.sendMessage).toHaveBeenCalledWith({
      uaid: 'uaid:planned-agent',
      message: expect.stringContaining('focused subtask'),
      streaming: undefined,
    });
  });

  it('falls back to direct search when findAgents does not have a task to plan', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.findAgents',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      query: 'proactive discovery',
      limit: 3,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('"query"');
    expect(service.agenticSearch).toHaveBeenCalled();
    expect(service.search).toHaveBeenCalled();
    expect(service.planDelegation).not.toHaveBeenCalled();
  });

  it('falls back to local search when planner returns no candidates', async () => {
    const service = createService();
    service.planDelegation.mockResolvedValue({
      summary: 'Delegation plan',
      opportunities: [],
    });
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
    expect(service.planDelegation).toHaveBeenCalledOnce();
    expect(service.agenticSearch).toHaveBeenCalledOnce();
    expect(service.search).toHaveBeenCalledOnce();
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

  it('falls back to local discovery when planner returns no summon candidates', async () => {
    const service = createService();
    service.planDelegation.mockResolvedValue({
      summary: 'Delegation plan',
      opportunities: [],
    });
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
    expect(service.planDelegation).toHaveBeenCalledOnce();
    expect(service.agenticSearch).toHaveBeenCalledOnce();
    expect(service.search).toHaveBeenCalledOnce();
    expect(service.sendMessage).toHaveBeenCalledOnce();
  });

  it('skips unroutable discovery candidates before sending a summon', async () => {
    const service = createService();
    service.planDelegation.mockResolvedValue({
      summary: 'Delegation plan',
      opportunities: [],
    });
    service.agenticSearch.mockResolvedValue({
      hits: [
        {
          agent: {
            uaid: 'uaid:bad-agent',
            registry: 'openrouter',
            communicationSupported: true,
            profile: {
              display_name: 'Bad Agent',
            },
          },
          score: 0.98,
        },
      ],
    });
    service.search.mockResolvedValue({
      hits: [
        {
          uaid: 'uaid:good-agent',
          registry: 'openrouter',
          profile: {
            display_name: 'Good Agent',
            alias: 'good-agent',
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 5,
    });
    service.resolveUaid
      .mockRejectedValueOnce(new Error('Registry broker request failed'))
      .mockResolvedValueOnce({ agent: { uaid: 'uaid:good-agent' } });

    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.summonAgent',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      task: 'Ask for a delegated answer.',
      query: 'test agent',
      mode: 'best-match',
      limit: 1,
      registries: ['openrouter'],
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Messages attempted: 1, succeeded: 1');
    expect(service.sendMessage).toHaveBeenCalledWith({
      uaid: 'uaid:good-agent',
      message: expect.stringContaining('focused subtask'),
      streaming: undefined,
    });
  });
});
