import { randomUUID } from 'node:crypto';
import { FastMCP } from 'fastmcp';
import type { Context } from 'fastmcp';
import { z } from 'zod';
import type { BrokerService } from './broker';
import { RegistryBrokerService } from './broker';
import { config } from './config';
import {
  buildDelegateMessage,
  inferDelegationType,
  isBrokerAuthError,
  normalizeAgenticFilter,
  pickDelegateCandidates,
} from './ranking';
import { logger } from './logger';

type TextContent = {
  type: 'text';
  text: string;
};

type ToolResult = {
  content: TextContent[];
};

type SessionAuth = Record<string, unknown> | undefined;

const searchSchema = z.object({
  query: z.string().min(1),
  task: z.string().optional(),
  limit: z.number().int().min(1).max(10).default(5),
  registries: z.array(z.string().min(1)).optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  protocols: z.array(z.string().min(1)).optional(),
  adapters: z.array(z.string().min(1)).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
  type: z.enum(['ai-agents', 'mcp-servers']).optional(),
});

const summonSchema = z.object({
  task: z.string().min(1),
  query: z.string().optional(),
  uaid: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(3).default(3),
  mode: z.enum(['best-match', 'fallback', 'parallel']).default('fallback'),
  message: z.string().min(1).optional(),
  streaming: z.boolean().optional(),
  registries: z.array(z.string().min(1)).optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  protocols: z.array(z.string().min(1)).optional(),
  adapters: z.array(z.string().min(1)).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
  type: z.enum(['ai-agents', 'mcp-servers']).optional(),
});

const sessionHistorySchema = z.object({
  sessionId: z.string().min(1),
});

const emptySchema = z.object({});

const instructions = [
  'Use registryBroker.summonAgent for bounded subtasks where a broker specialist can add value without taking over the whole user request.',
  'Use registryBroker.findAgents when you need to inspect the shortlist, explain the ranking, or let the user choose the target agent.',
  'Prefer best-match when one strong answer is enough, fallback when resilience matters, and parallel only when comparing approaches is worth the extra latency.',
  'If the user or workflow already knows the UAID, pass it directly and skip discovery.',
  'Treat broker output as delegated input to integrate, verify, and summarize in your own answer.',
].join('\n');

interface ToolDefinition<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: S;
  execute: (args: z.input<S>, context?: Context<SessionAuth>) => Promise<ToolResult>;
  annotations?: {
    title: string;
    readOnlyHint?: true;
    destructiveHint?: true;
  };
}

type SafeResult<T> = {
  value?: T;
  error?: string;
};

export function createToolDefinitions(
  service: BrokerService,
): Array<ToolDefinition<typeof searchSchema | typeof summonSchema | typeof sessionHistorySchema | typeof emptySchema>> {
  return [
    {
      name: 'registryBroker.findAgents',
      description: 'Find and rank likely broker agents or MCP servers for a task or query.',
      parameters: searchSchema,
      annotations: {
        title: 'Registry Broker Find Agents',
        readOnlyHint: true,
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = searchSchema.parse(args);
        logger.info({ requestId, tool: 'registryBroker.findAgents' }, 'tool.invoke');
        const query = input.query;
        const delegationType = input.type ?? inferDelegationType(`${input.task ?? ''}\n${query}`);
        const searches = await collectSearches(service, query, input.limit, {
          registries: input.registries,
          capabilities: input.capabilities,
          protocols: input.protocols,
          adapters: input.adapters,
          minTrust: input.minTrust,
          verified: input.verified,
          online: input.online,
          type: delegationType,
        });
        const candidates = pickDelegateCandidates(
          [searches.agentic.value, searches.vector.value, searches.keyword.value],
          {
            limit: input.limit,
            registries: input.registries,
            minTrust: input.minTrust,
            verified: input.verified,
            online: input.online,
          },
        ).map((candidate) => ({
          ...candidate,
          suggestedMessage: buildDelegateMessage(input.task ?? query, candidate),
        }));
        logger.info(
          { requestId, tool: 'registryBroker.findAgents', candidates: candidates.length },
          'tool.success',
        );
        return resultWithPayload(
          [
            `Found ${candidates.length} ranked candidates for ${JSON.stringify(query)}.`,
            candidates.length
              ? candidates
                  .map((candidate, index) => `${index + 1}. ${candidate.label} — ${candidate.uaid}`)
                  .join('\n')
              : 'No candidates matched the broker search results.',
          ].join('\n'),
          'registryBroker.findAgents',
          {
            query,
            task: input.task,
            candidates,
            sources: {
              agentic: searches.agentic.error ? { error: searches.agentic.error } : searches.agentic.value,
              vector: searches.vector.error ? { error: searches.vector.error } : searches.vector.value,
              keyword: searches.keyword.error ? { error: searches.keyword.error } : searches.keyword.value,
            },
          },
        );
      },
    },
    {
      name: 'registryBroker.summonAgent',
      description: 'Discover the strongest broker candidate for a subtask, message it, and return the broker session result.',
      parameters: summonSchema,
      annotations: {
        title: 'Registry Broker Summon Agent',
        destructiveHint: true,
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = summonSchema.parse(args);
        logger.info({ requestId, tool: 'registryBroker.summonAgent' }, 'tool.invoke');

        const query = input.query ?? input.task;
        const delegationType = input.type ?? inferDelegationType(`${input.task}\n${query}`);
        const searches = input.uaid
          ? undefined
          : await collectSearches(service, query, input.limit, {
              registries: input.registries,
              capabilities: input.capabilities,
              protocols: input.protocols,
              adapters: input.adapters,
              minTrust: input.minTrust,
              verified: input.verified,
              online: input.online,
              type: delegationType,
            });

        const candidates = input.uaid
          ? [{ uaid: input.uaid, label: input.uaid }]
          : pickDelegateCandidates(
              [searches?.agentic.value, searches?.vector.value, searches?.keyword.value],
              {
                limit: input.limit,
                registries: input.registries,
                minTrust: input.minTrust,
                verified: input.verified,
                online: input.online,
              },
            );

        if (candidates.length === 0) {
          logger.warn({ requestId, tool: 'registryBroker.summonAgent' }, 'tool.no_candidates');
          return resultWithPayload(
            `No broker candidates were found for ${JSON.stringify(query)}.`,
            'registryBroker.summonAgent',
            {
              query,
              task: input.task,
              candidates: [],
              sources: searches
                ? {
                    agentic: searches.agentic.error ? { error: searches.agentic.error } : searches.agentic.value,
                    vector: searches.vector.error ? { error: searches.vector.error } : searches.vector.value,
                    keyword: searches.keyword.error ? { error: searches.keyword.error } : searches.keyword.value,
                  }
                : undefined,
            },
          );
        }

        const chosen = input.mode === 'best-match' ? candidates.slice(0, 1) : candidates.slice(0, input.limit);
        const enlisted =
          input.mode === 'parallel'
            ? await Promise.all(chosen.map((candidate) => sendToCandidate(service, candidate, input)))
            : await sendSequentially(service, chosen, input);

        const successCount = enlisted.filter((entry) => entry.status === 'ok').length;
        const authBlocked = enlisted.some(
          (entry) => entry.status === 'error' && entry.error && isBrokerAuthError(entry.error),
        );

        logger.info(
          {
            requestId,
            tool: 'registryBroker.summonAgent',
            attempted: enlisted.length,
            succeeded: successCount,
          },
          'tool.success',
        );

        return resultWithPayload(
          [
            `Summon mode: ${input.mode}`,
            `Candidates considered: ${candidates.length}`,
            `Messages attempted: ${enlisted.length}, succeeded: ${successCount}`,
            authBlocked
              ? 'Broker auth is required for chat. Set REGISTRY_BROKER_API_KEY and retry.'
              : undefined,
            ...enlisted.map(
              (entry, index) =>
                `${index + 1}. ${entry.label} — ${entry.uaid} (${entry.status})`,
            ),
          ]
            .filter(Boolean)
            .join('\n'),
          'registryBroker.summonAgent',
          {
            query,
            task: input.task,
            mode: input.mode,
            candidates,
            enlisted,
            sources: searches
              ? {
                  agentic: searches.agentic.error ? { error: searches.agentic.error } : searches.agentic.value,
                  vector: searches.vector.error ? { error: searches.vector.error } : searches.vector.value,
                  keyword: searches.keyword.error ? { error: searches.keyword.error } : searches.keyword.value,
                }
              : undefined,
          },
        );
      },
    },
    {
      name: 'registryBroker.sessionHistory',
      description: 'Fetch the broker chat history for a session.',
      parameters: sessionHistorySchema,
      annotations: {
        title: 'Registry Broker Session History',
        readOnlyHint: true,
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = sessionHistorySchema.parse(args);
        logger.info({ requestId, tool: 'registryBroker.sessionHistory' }, 'tool.invoke');
        const history = await service.getHistory(input.sessionId);
        logger.info({ requestId, tool: 'registryBroker.sessionHistory' }, 'tool.success');
        return resultWithPayload(
          `Fetched history for session ${input.sessionId}.`,
          'registryBroker.sessionHistory',
          {
            sessionId: input.sessionId,
            history,
          },
        );
      },
    },
    {
      name: 'registryBroker.health',
      description: 'Check plugin runtime health plus broker stats and protocol metadata.',
      parameters: emptySchema,
      annotations: {
        title: 'Registry Broker Health',
        readOnlyHint: true,
      },
      execute: async (_args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        logger.info({ requestId, tool: 'registryBroker.health' }, 'tool.invoke');
        const [stats, protocols] = await Promise.all([
          safeInvoke(() => service.stats()),
          safeInvoke(() => service.listProtocols()),
        ]);
        logger.info({ requestId, tool: 'registryBroker.health' }, 'tool.success');
        return resultWithPayload(
          'Registry Broker plugin health collected.',
          'registryBroker.health',
          {
            plugin: {
              name: config.serverName,
              brokerBaseUrl: config.brokerBaseUrl,
              apiKeyConfigured: Boolean(config.brokerApiKey),
            },
            stats: stats.error ? { error: stats.error } : stats.value,
            protocols: protocols.error ? { error: protocols.error } : protocols.value,
          },
        );
      },
    },
  ];
}

export function createMcpServer(service: BrokerService = new RegistryBrokerService()): FastMCP {
  const server = new FastMCP({
    name: config.serverName,
    version: '0.1.0',
    instructions,
    logger: {
      debug: (...args: unknown[]) => logger.debug(args),
      info: (...args: unknown[]) => logger.info(args),
      warn: (...args: unknown[]) => logger.warn(args),
      error: (...args: unknown[]) => logger.error(args),
      log: (...args: unknown[]) => logger.info(args),
    },
  });

  for (const definition of createToolDefinitions(service)) {
    server.addTool(definition);
  }

  return server;
}

async function collectSearches(
  service: BrokerService,
  query: string,
  limit: number,
  filters: {
    registries?: string[];
    capabilities?: string[];
    protocols?: string[];
    adapters?: string[];
    minTrust?: number;
    verified?: boolean;
    online?: boolean;
    type?: 'ai-agents' | 'mcp-servers';
  },
): Promise<{
  agentic: SafeResult<unknown>;
  vector: SafeResult<unknown>;
  keyword: SafeResult<unknown>;
}> {
  const keywordParams = {
    q: query,
    limit: Math.min(50, limit * 4),
    registries: filters.registries,
    capabilities: filters.capabilities,
    protocols: filters.protocols,
    adapters: filters.adapters,
    minTrust: filters.minTrust,
    verified: filters.verified,
    online: filters.online,
    type: filters.type,
  };

  const [agentic, vector, keyword] = await Promise.all([
    safeInvoke(() =>
      service.agenticSearch({
        query,
        limit: Math.min(20, Math.max(limit * 4, limit)),
        offset: 0,
        filter: normalizeAgenticFilter({
          registries: filters.registries,
          capabilities: filters.capabilities,
          protocols: filters.protocols,
          adapters: filters.adapters,
          type: filters.type,
        }),
      }),
    ),
    safeInvoke(() => service.vectorSearch(query, limit)),
    safeInvoke(() => service.search(keywordParams)),
  ]);

  return { agentic, vector, keyword };
}

async function sendSequentially(
  service: BrokerService,
  candidates: Array<{ uaid: string; label: string }>,
  input: z.infer<typeof summonSchema>,
): Promise<
  Array<{
    uaid: string;
    label: string;
    message: string;
    status: 'ok' | 'error';
    response?: unknown;
    error?: string;
  }>
> {
  const results: Array<{
    uaid: string;
    label: string;
    message: string;
    status: 'ok' | 'error';
    response?: unknown;
    error?: string;
  }> = [];

  for (const candidate of candidates) {
    const result = await sendToCandidate(service, candidate, input);
    results.push(result);
    if (input.mode === 'best-match') {
      break;
    }
    if (result.status === 'ok' || (result.error && isBrokerAuthError(result.error))) {
      break;
    }
  }

  return results;
}

async function sendToCandidate(
  service: BrokerService,
  candidate: { uaid: string; label: string },
  input: z.infer<typeof summonSchema>,
): Promise<{
  uaid: string;
  label: string;
  message: string;
  status: 'ok' | 'error';
  response?: unknown;
  error?: string;
}> {
  const message = input.message ?? buildDelegateMessage(input.task, candidate);
  const response = await safeInvoke(() =>
    service.sendMessage({
      uaid: candidate.uaid,
      message,
      streaming: input.streaming,
    }),
  );

  if (response.error) {
    return {
      uaid: candidate.uaid,
      label: candidate.label,
      message,
      status: 'error',
      error: response.error,
    };
  }

  return {
    uaid: candidate.uaid,
    label: candidate.label,
    message,
    status: 'ok',
    response: response.value,
  };
}

async function safeInvoke<T>(callback: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    return { value: await callback() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resultWithPayload(summary: string, label: string, payload: unknown): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: summary,
      },
      {
        type: 'text',
        text: `${label}:\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  };
}
