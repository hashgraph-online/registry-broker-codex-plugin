import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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
    delegate: vi.fn().mockResolvedValue({
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
    resolveUaid: vi.fn().mockResolvedValue({}),
  };
}

describe('registry broker mcp tools', () => {
  it('does not expose an end-user health tool', () => {
    const service = createService();

    const toolNames = createToolDefinitions(service).map((entry) => entry.name);

    expect(toolNames).not.toContain('registryBroker.health');
  });

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
    expect(service.delegate).toHaveBeenCalledOnce();
    expect(service.agenticSearch).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
  });

  it('uses planner-selected candidates before local ranking in findAgents', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
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
    expect(service.delegate).toHaveBeenCalledOnce();
    expect(service.agenticSearch).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
  });

  it('returns delegation opportunities from delegate', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.delegate',
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
    expect(text).toContain('Recommended candidate: Test Agent');
    expect(text).toContain('Selected opportunity: research-specialist');
    expect(text).toContain('research-specialist');
    expect(service.delegate).toHaveBeenCalledOnce();
  });

  it('folds structured delegation fields into planner context', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.delegate',
    );

    expect(tool).toBeDefined();

    await tool!.execute({
      task: 'Review this TypeScript patch.',
      deliverable: 'Return a concise review plus fix plan.',
      constraints: ['Do not change public APIs.'],
      mustInclude: ['Root cause', 'regression risks'],
      acceptanceCriteria: ['Cites the highest-risk issue first'],
      limit: 2,
    });

    expect(service.delegate).toHaveBeenCalledWith({
      task: 'Review this TypeScript patch.',
      context: expect.stringContaining('Deliverable:'),
      workspace: undefined,
      limit: 2,
      filter: undefined,
    });
    expect(service.delegate.mock.calls[0]?.[0].context).toContain('Must include:');
    expect(service.delegate.mock.calls[0]?.[0].context).toContain('Acceptance criteria:');
  });

  it('passes canonical delegation filters to the broker planner', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.delegate',
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

    expect(service.delegate).toHaveBeenCalledWith({
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
    expect(service.delegate).toHaveBeenCalledOnce();
    expect(service.agenticSearch).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
    expect(service.sendMessage).toHaveBeenCalledOnce();
  });

  it('uses planner-selected candidates before local ranking in summonAgent', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
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

    expect(service.delegate).toHaveBeenCalledOnce();
    expect(service.agenticSearch).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
    expect(service.sendMessage).toHaveBeenCalledWith({
      uaid: 'uaid:planned-agent',
      message: expect.stringContaining('focused subtask'),
      streaming: undefined,
    });
  });

  it('trims planner candidate strings before summoning', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
      summary: 'Delegation plan',
      opportunities: [
        {
          id: 'implementation-specialist',
          title: 'Implement a focused subsystem fix',
          candidates: [
            {
              uaid: '  uaid:planned-agent  ',
              label: '  Planned Agent  ',
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

    expect(service.sendMessage).toHaveBeenCalledWith({
      uaid: 'uaid:planned-agent',
      message: expect.stringContaining('Planned Agent (uaid:planned-agent)'),
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
    expect(service.delegate).not.toHaveBeenCalled();
  });

  it('falls back to local search when planner returns no candidates', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
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
    expect(service.delegate).toHaveBeenCalledOnce();
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

  it('supports summon dry-run previews without sending a broker message', async () => {
    const service = createService();
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.summonAgent',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      task: 'Review this TypeScript patch.',
      query: 'test agent',
      deliverable: 'Return the top risk and a one-step fix plan.',
      mustInclude: ['Root cause'],
      dryRun: true,
      mode: 'best-match',
      limit: 1,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Dry run only. No broker message sent.');
    expect(service.sendMessage).not.toHaveBeenCalled();

    const payload = extractToolPayload(result, 'registryBroker.summonAgent');
    expect(payload.dryRun).toBe(true);
    expect(payload.dispatchPlan?.[0]?.uaid).toBe('uaid:test-agent');
    expect(payload.dispatchPlan?.[0]?.message).toContain('Must include:');
  });

  it('surfaces broker review-shortlist guidance in findAgents without local reranking drift', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
      summary: 'Delegation plan',
      recommendation: {
        action: 'review-shortlist',
        opportunityId: 'implementation-specialist',
        reason: 'Implementation and verification are both viable next steps.',
      },
      opportunities: [
        {
          id: 'implementation-specialist',
          title: 'Implement the fix',
          reason: 'A code specialist can patch the bug quickly.',
          candidates: [
            {
              uaid: 'uaid:implementation-agent',
              label: 'Implementation Agent',
            },
            {
              uaid: 'uaid:verification-agent',
              label: 'Verification Agent',
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
      query: 'fix a TypeScript plugin bug',
      task: 'Fix this TypeScript plugin bug and verify the patch.',
      limit: 2,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Recommendation: review-shortlist');
    expect(text).toContain('Reason: Implementation and verification are both viable next steps.');
    expect(text).toContain('Implementation Agent');
    expect(text).toContain('Verification Agent');
    expect(service.search).not.toHaveBeenCalled();
    expect(service.agenticSearch).not.toHaveBeenCalled();
  });

  it('returns handle-locally from summonAgent without sending a broker message', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
      summary: 'Delegation plan',
      recommendation: {
        action: 'handle-locally',
        reason: 'This looks like a small local edit with tight workspace coupling.',
      },
      opportunities: [],
    });
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.summonAgent',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      task: 'Rename one local constant and update one import.',
      mode: 'best-match',
      limit: 1,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Recommendation: handle-locally');
    expect(text).toContain('Reason: This looks like a small local edit with tight workspace coupling.');
    expect(service.sendMessage).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
    expect(service.agenticSearch).not.toHaveBeenCalled();
  });

  it('falls back to search in findAgents when handle-locally has no opportunity candidates', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
      summary: 'Delegation plan',
      recommendation: {
        action: 'handle-locally',
        reason: 'This is probably best handled locally unless discovery finds a clearly useful specialist.',
      },
      opportunities: [],
    });
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.findAgents',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      query: 'TypeScript bug verification specialist',
      task: 'Rename one local constant and update one import.',
      limit: 1,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Recommendation: handle-locally');
    expect(text).toContain('Test Agent');
    expect(service.search).toHaveBeenCalled();
  });

  it('returns broker shortlist guidance from summonAgent before sending when review is recommended', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
      summary: 'Delegation plan',
      recommendation: {
        action: 'review-shortlist',
        opportunityId: 'design-specialist',
        reason: 'Two strong design delegates are close enough that the user should review the shortlist.',
      },
      opportunities: [
        {
          id: 'design-specialist',
          title: 'Design the landing page and onboarding flow',
          reason: 'This needs a design specialist with strong consumer UX taste.',
          candidates: [
            {
              uaid: 'uaid:landing-page-agent',
              label: 'Landing Page Agent',
            },
            {
              uaid: 'uaid:onboarding-agent',
              label: 'Onboarding Agent',
            },
          ],
        },
      ],
    });
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.summonAgent',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      task: 'Design a landing page and onboarding UX for this feature.',
      mode: 'best-match',
      limit: 1,
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('Recommendation: review-shortlist');
    expect(text).toContain('Reason: Two strong design delegates are close enough that the user should review the shortlist.');
    expect(text).toContain('Landing Page Agent');
    expect(text).toContain('Onboarding Agent');
    expect(service.sendMessage).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
    expect(service.agenticSearch).not.toHaveBeenCalled();
  });

  it('returns next-action hints for shortlist review and successful summon flows', async () => {
    const reviewService = createService();
    reviewService.delegate.mockResolvedValue({
      summary: 'Delegation plan',
      recommendation: {
        action: 'review-shortlist',
        opportunityId: 'design-specialist',
      },
      opportunities: [
        {
          id: 'design-specialist',
          candidates: [
            {
              uaid: 'uaid:landing-page-agent',
              label: 'Landing Page Agent',
            },
          ],
        },
      ],
    });
    const reviewTool = createToolDefinitions(reviewService).find(
      (entry) => entry.name === 'registryBroker.findAgents',
    );

    expect(reviewTool).toBeDefined();

    const shortlistResult = await reviewTool!.execute({
      query: 'landing page onboarding',
      task: 'Design a landing page and onboarding UX for this feature.',
      limit: 1,
    });
    const shortlistPayload = extractToolPayload(shortlistResult, 'registryBroker.findAgents');
    expect(shortlistPayload.nextAction?.type).toBe('review-shortlist');
    expect(shortlistPayload.nextAction?.tool).toBe('registryBroker.summonAgent');
    expect(shortlistPayload.nextAction?.suggestedArgs?.uaid).toBe('uaid:landing-page-agent');

    const summonService = createService();
    const summonTool = createToolDefinitions(summonService).find(
      (entry) => entry.name === 'registryBroker.summonAgent',
    );

    expect(summonTool).toBeDefined();

    const summonResult = await summonTool!.execute({
      task: 'Ask for a delegated answer.',
      mode: 'best-match',
      limit: 1,
    });
    const summonPayload = extractToolPayload(summonResult, 'registryBroker.summonAgent');
    expect(summonPayload.nextAction?.type).toBe('recover-session');
    expect(summonPayload.nextAction?.tool).toBe('registryBroker.sessionHistory');
    expect(summonPayload.nextAction?.sessionIds).toEqual(['session-1']);
  });

  it('summarizes broker session history for follow-up work', async () => {
    const service = createService();
    service.getHistory.mockResolvedValue({
      sessionId: 'session-1',
      history: [
        {
          role: 'user',
          content: 'Please review this patch.',
        },
        {
          role: 'assistant',
          content: 'Top risk: stale planner fallback. Fix src/mcp.ts and rerun tests.',
        },
      ],
      historyTtlSeconds: 900,
    });
    const tool = createToolDefinitions(service).find(
      (entry) => entry.name === 'registryBroker.sessionHistory',
    );

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      sessionId: 'session-1',
    });

    const text = result.content.map((entry) => entry.text).join('\n');
    expect(text).toContain('History messages: 2');
    expect(text).toContain('Latest reply: Top risk: stale planner fallback.');

    const payload = extractToolPayload(result, 'registryBroker.sessionHistory');
    expect(payload.summary?.messageCount).toBe(2);
    expect(payload.summary?.latestRole).toBe('assistant');
    expect(payload.summary?.historyTtlSeconds).toBe(900);
  });

  it('falls back to local discovery when planner returns no summon candidates', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
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
    expect(service.delegate).toHaveBeenCalledOnce();
    expect(service.agenticSearch).toHaveBeenCalledOnce();
    expect(service.search).toHaveBeenCalledOnce();
    expect(service.sendMessage).toHaveBeenCalledOnce();
  });

  it('skips unroutable discovery candidates before sending a summon', async () => {
    const service = createService();
    service.delegate.mockResolvedValue({
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

const extractedToolPayloadSchema = z.object({
  dryRun: z.boolean().optional(),
  dispatchPlan: z
    .array(
      z.object({
        uaid: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
  nextAction: z
    .object({
      type: z.string().optional(),
      tool: z.string().optional(),
      suggestedArgs: z
        .object({
          uaid: z.string().optional(),
        })
        .optional(),
      sessionIds: z.array(z.string()).optional(),
    })
    .optional(),
  summary: z
    .object({
      messageCount: z.number().optional(),
      latestRole: z.string().optional(),
      historyTtlSeconds: z.number().optional(),
    })
    .optional(),
});

type ExtractedToolPayload = z.infer<typeof extractedToolPayloadSchema>;

function extractToolPayload(
  result: Awaited<
    ReturnType<
      NonNullable<ReturnType<typeof createToolDefinitions>[number]['execute']>
    >
  >,
  label: string,
): ExtractedToolPayload {
  const payloadText = result.content.find((entry) => entry.text.startsWith(`${label}:\n`))?.text;
  expect(payloadText).toBeDefined();
  return extractedToolPayloadSchema.parse(
    JSON.parse(payloadText!.slice(label.length + 2)),
  );
}
