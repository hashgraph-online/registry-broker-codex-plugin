import { randomUUID } from 'node:crypto';
import { FastMCP } from 'fastmcp';
import type { Context } from 'fastmcp';
import { z } from 'zod';
import type { BrokerService } from './broker';
import { RegistryBrokerService } from './broker';
import { config } from './config';
import {
  buildDelegateMessage,
  type DelegateCandidate,
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

const workspaceContextSchema = z
  .object({
    openFiles: z.array(z.string().min(1)).optional(),
    modifiedFiles: z.array(z.string().min(1)).optional(),
    relatedPaths: z.array(z.string().min(1)).optional(),
    errors: z.array(z.string().min(1)).optional(),
    commands: z.array(z.string().min(1)).optional(),
    languages: z.array(z.string().min(1)).optional(),
  })
  .optional();

const searchSchema = z.object({
  query: z.string().min(1),
  task: z.string().optional(),
  opportunityId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).default(5),
  registries: z.array(z.string().min(1)).optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  protocols: z.array(z.string().min(1)).optional(),
  adapters: z.array(z.string().min(1)).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
  type: z.enum(['ai-agents', 'mcp-servers']).optional(),
  workspace: workspaceContextSchema,
});

const planDelegationSchema = z.object({
  task: z.string().min(1),
  context: z.string().optional(),
  limit: z.number().int().min(1).max(5).default(3),
  registries: z.array(z.string().min(1)).optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  protocols: z.array(z.string().min(1)).optional(),
  adapters: z.array(z.string().min(1)).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
  type: z.enum(['ai-agents', 'mcp-servers']).optional(),
  workspace: workspaceContextSchema,
});

const summonSchema = z.object({
  task: z.string().min(1),
  query: z.string().optional(),
  opportunityId: z.string().min(1).optional(),
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
  workspace: workspaceContextSchema,
});

const sessionHistorySchema = z.object({
  sessionId: z.string().min(1),
});

const emptySchema = z.object({});

const instructions = [
  'For medium or large tasks, use registryBroker.planDelegation early to discover where specialist help would actually add leverage.',
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

type PlannerOpportunity = {
  id?: string;
  title?: string;
  reason?: string;
  role?: string;
  suggestedMode?: string;
  searchQueries?: string[];
  candidates?: unknown[];
};

type PlannerRecommendation = {
  action?: string;
  confidence?: number;
  reason?: string;
  opportunityId?: string;
  candidate?: unknown;
};

type PlannerSelection = {
  opportunities: PlannerOpportunity[];
  selectedOpportunity?: PlannerOpportunity;
  candidates: DelegateCandidate[];
  recommendation?: PlannerRecommendation;
};

export function createToolDefinitions(
  service: BrokerService,
): Array<
  ToolDefinition<
    | typeof searchSchema
    | typeof planDelegationSchema
    | typeof summonSchema
    | typeof sessionHistorySchema
    | typeof emptySchema
  >
> {
  return [
    {
      name: 'registryBroker.planDelegation',
      description: 'Turn a free-form task into ranked broker delegation opportunities.',
      parameters: planDelegationSchema,
      annotations: {
        title: 'Registry Broker Plan Delegation',
        readOnlyHint: true,
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = planDelegationSchema.parse(args);
        logger.info({ requestId, tool: 'registryBroker.planDelegation' }, 'tool.invoke');

        const result = await service.planDelegation({
          task: input.task,
          context: input.context,
          workspace: input.workspace,
          limit: input.limit,
          filter: normalizeAgenticFilter({
            registries: input.registries,
            capabilities: input.capabilities,
            protocols: input.protocols,
            adapters: input.adapters,
            minTrust: input.minTrust,
            verified: input.verified,
            online: input.online,
            type: input.type,
          }),
        });

        logger.info({ requestId, tool: 'registryBroker.planDelegation' }, 'tool.success');

        const opportunityCount =
          typeof result === 'object' &&
          result !== null &&
          Array.isArray((result as { opportunities?: unknown[] }).opportunities)
            ? (result as { opportunities?: unknown[] }).opportunities!.length
            : 0;
        const recommendationAction =
          typeof result === 'object' &&
          result !== null &&
          typeof (result as { recommendation?: { action?: unknown } }).recommendation?.action ===
            'string'
            ? (result as { recommendation: { action: string } }).recommendation.action
            : undefined;

        return resultWithPayload(
          [
            `Delegation opportunities: ${opportunityCount}`,
            recommendationAction ? `Recommendation: ${recommendationAction}` : undefined,
          ]
            .filter(Boolean)
            .join('\n'),
          'registryBroker.planDelegation',
          result,
        );
      },
    },
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
        const task = input.task;
        const query = input.query;
        const taskText = `${task ?? ''}\n${query}`;
        const planResult = task
          ? await safeInvoke(() =>
              service.planDelegation({
                task,
                context: query !== task ? query : undefined,
                workspace: input.workspace,
                limit: computePlannerLimit(input.limit),
                filter: normalizeAgenticFilter({
                  registries: input.registries,
                  capabilities: input.capabilities,
                  protocols: input.protocols,
                  adapters: input.adapters,
                  minTrust: input.minTrust,
                  verified: input.verified,
                  online: input.online,
                  type: input.type ?? inferDelegationType(taskText),
                }),
              }),
            )
          : undefined;
        const plannerSelection =
          planResult?.value !== undefined
            ? selectPlannerCandidates(planResult.value, {
                task,
                query,
                opportunityId: input.opportunityId,
              })
            : undefined;
        const shortlist = plannerSelection && plannerSelection.candidates.length > 0
          ? await preferReachableCandidates(
              service,
              plannerSelection.candidates.map((candidate) => ({
                ...candidate,
                suggestedMessage: buildDelegateMessage(task ?? query, candidate),
              })),
              input.limit,
              Math.min(computeRankingPoolSize(taskText, input.limit), plannerSelection.candidates.length),
            )
          : await findFallbackCandidates(service, query, {
              task,
              limit: input.limit,
              registries: input.registries,
              capabilities: input.capabilities,
              protocols: input.protocols,
              adapters: input.adapters,
              minTrust: input.minTrust,
              verified: input.verified,
              online: input.online,
              type: input.type,
            });
        logger.info(
          { requestId, tool: 'registryBroker.findAgents', candidates: shortlist.length },
          'tool.success',
        );
        return resultWithPayload(
          [
            `Found ${shortlist.length} ranked candidates for ${JSON.stringify(query)}.`,
            shortlist.length
              ? shortlist
                  .map((candidate, index) => `${index + 1}. ${candidate.label} — ${candidate.uaid}`)
                  .join('\n')
              : 'No candidates matched the broker search results.',
          ].join('\n'),
          'registryBroker.findAgents',
          {
            strategy:
              plannerSelection && plannerSelection.candidates.length > 0
                ? 'broker-plan'
                : 'search-fallback',
            query,
            task,
            selectedOpportunity: plannerSelection?.selectedOpportunity,
            opportunities: plannerSelection?.opportunities,
            candidates: shortlist,
            planner: planResult
              ? planResult.error
                ? { error: planResult.error }
                : planResult.value
              : undefined,
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
        const taskText = `${input.task}\n${query}`;
        const desiredCandidateCount = input.mode === 'best-match' ? 1 : input.limit;
        const planResult = input.uaid
          ? undefined
          : await safeInvoke(() =>
              service.planDelegation({
                task: input.task,
                context: query !== input.task ? query : undefined,
                workspace: input.workspace,
                limit: computePlannerLimit(desiredCandidateCount),
                filter: normalizeAgenticFilter({
                  registries: input.registries,
                  capabilities: input.capabilities,
                  protocols: input.protocols,
                  adapters: input.adapters,
                  minTrust: input.minTrust,
                  verified: input.verified,
                  online: input.online,
                  type: input.type ?? inferDelegationType(taskText),
                }),
              }),
            );
        const plannerSelection =
          !input.uaid && planResult?.value !== undefined
            ? selectPlannerCandidates(planResult.value, {
                task: input.task,
                query,
                opportunityId: input.opportunityId,
              })
            : undefined;
        const rankedCandidates = input.uaid
          ? [{ uaid: input.uaid, label: input.uaid }]
          : plannerSelection && plannerSelection.candidates.length > 0
            ? plannerSelection.candidates
            : await findFallbackCandidates(service, query, {
                task: input.task,
                limit: desiredCandidateCount,
                registries: input.registries,
                capabilities: input.capabilities,
                protocols: input.protocols,
                adapters: input.adapters,
                minTrust: input.minTrust,
                verified: input.verified,
                online: input.online,
                type: input.type,
                desiredCandidateCount,
              });
        const candidates = input.uaid
          ? rankedCandidates
          : await preferReachableCandidates(
              service,
              rankedCandidates,
              desiredCandidateCount,
              Math.min(computeRankingPoolSize(taskText, desiredCandidateCount), rankedCandidates.length),
            );

        if (candidates.length === 0) {
          logger.warn({ requestId, tool: 'registryBroker.summonAgent' }, 'tool.no_candidates');
          return resultWithPayload(
            `No broker candidates were found for ${JSON.stringify(query)}.`,
            'registryBroker.summonAgent',
            {
              strategy:
                plannerSelection && plannerSelection.candidates.length > 0
                  ? 'broker-plan'
                  : 'search-fallback',
              query,
              task: input.task,
              candidates: [],
              selectedOpportunity: plannerSelection?.selectedOpportunity,
              opportunities: plannerSelection?.opportunities,
              planner: planResult
                ? planResult.error
                  ? { error: planResult.error }
                  : planResult.value
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
            strategy:
              plannerSelection && plannerSelection.candidates.length > 0
                ? 'broker-plan'
                : input.uaid
                  ? 'direct-uaid'
                  : 'search-fallback',
            query,
            task: input.task,
            mode: input.mode,
            selectedOpportunity: plannerSelection?.selectedOpportunity,
            opportunities: plannerSelection?.opportunities,
            candidates,
            enlisted,
            planner: planResult
              ? planResult.error
                ? { error: planResult.error }
                : planResult.value
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
          minTrust: filters.minTrust,
          verified: filters.verified,
          online: filters.online,
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

async function preferReachableCandidates(
  service: BrokerService,
  candidates: DelegateCandidate[],
  desiredCount: number,
  scanLimit: number,
): Promise<DelegateCandidate[]> {
  if (candidates.length === 0 || desiredCount <= 0 || scanLimit <= 0) {
    return [];
  }

  const scanned = candidates.slice(0, scanLimit);
  const resolutions = await Promise.all(
    scanned.map(async (candidate) => ({
      candidate,
      resolution: await safeInvoke(() => service.resolveUaid(candidate.uaid)),
    })),
  );

  const reachable = resolutions
    .filter((entry) => isResolvedCandidate(entry.resolution.value))
    .map((entry) => entry.candidate);

  return (reachable.length > 0 ? reachable : scanned).slice(0, desiredCount);
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

function isResolvedCandidate(value: unknown): boolean {
  if (!isJsonRecord(value)) {
    return false;
  }

  if (isJsonRecord(value.agent)) {
    return true;
  }

  return typeof value.uaid === 'string' && value.uaid.trim().length > 0;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function computeRankingPoolSize(taskText: string, limit: number): number {
  if (/\b(code|coding|debug|bug|typescript|javascript|patch|refactor|implement|developer|software)\b/i.test(taskText)) {
    return 60;
  }

  return Math.max(20, limit * 8);
}

function computePlannerLimit(limit: number): number {
  return Math.min(Math.max(limit, 3), 5);
}

async function findFallbackCandidates(
  service: BrokerService,
  query: string,
  filters: {
    task?: string;
    limit: number;
    desiredCandidateCount?: number;
    registries?: string[];
    capabilities?: string[];
    protocols?: string[];
    adapters?: string[];
    minTrust?: number;
    verified?: boolean;
    online?: boolean;
    type?: 'ai-agents' | 'mcp-servers';
  },
): Promise<DelegateCandidate[]> {
  const taskText = `${filters.task ?? ''}\n${query}`;
  const desiredCandidateCount = filters.desiredCandidateCount ?? filters.limit;
  const delegationType = filters.type ?? inferDelegationType(taskText);
  const rankingPoolSize = computeRankingPoolSize(taskText, desiredCandidateCount);
  const searches = await collectSearches(service, query, rankingPoolSize, {
    registries: filters.registries,
    capabilities: filters.capabilities,
    protocols: filters.protocols,
    adapters: filters.adapters,
    minTrust: filters.minTrust,
    verified: filters.verified,
    online: filters.online,
    type: delegationType,
  });
  const candidates = pickDelegateCandidates(
    [searches.agentic.value, searches.vector.value, searches.keyword.value],
    {
      limit: rankingPoolSize,
      registries: filters.registries,
      minTrust: filters.minTrust,
      verified: filters.verified,
      online: filters.online,
      taskText,
    },
  ).map((candidate) => ({
    ...candidate,
    suggestedMessage: buildDelegateMessage(filters.task ?? query, candidate),
  }));

  return preferReachableCandidates(
    service,
    candidates,
    filters.limit,
    Math.min(rankingPoolSize, candidates.length),
  );
}

function selectPlannerCandidates(
  payload: unknown,
  input: {
    task?: string;
    query?: string;
    opportunityId?: string;
  },
): PlannerSelection | undefined {
  if (!isJsonRecord(payload) || !Array.isArray(payload.opportunities)) {
    return undefined;
  }

  const opportunities = payload.opportunities.filter(isJsonRecord);
  if (opportunities.length === 0) {
    return undefined;
  }

  const recommendation = isJsonRecord(payload.recommendation)
    ? (payload.recommendation as PlannerRecommendation)
    : undefined;

  if (recommendation?.action === 'delegate-now') {
    const selectedOpportunity = recommendation.opportunityId
      ? opportunities.find((opportunity) => opportunity.id === recommendation.opportunityId)
      : selectPlannerOpportunity(opportunities, input);
    const directCandidate = recommendation.candidate
      ? plannerCandidateToDelegate(recommendation.candidate)
      : undefined;
    const opportunityCandidates = selectedOpportunity
      ? extractPlannerCandidates(selectedOpportunity)
      : [];
    const candidates = directCandidate ? [directCandidate] : opportunityCandidates;

    if (candidates.length > 0) {
      return {
        opportunities,
        selectedOpportunity,
        candidates,
        recommendation,
      };
    }
  }

  const selectedOpportunity = selectPlannerOpportunity(opportunities, input);
  const candidates = selectedOpportunity
    ? extractPlannerCandidates(selectedOpportunity)
    : [];

  return {
    opportunities,
    selectedOpportunity,
    candidates,
    recommendation,
  };
}

function selectPlannerOpportunity(
  opportunities: PlannerOpportunity[],
  input: {
    task?: string;
    query?: string;
    opportunityId?: string;
  },
): PlannerOpportunity | undefined {
  if (input.opportunityId) {
    const explicit = opportunities.find(
      (opportunity) => opportunity.id === input.opportunityId,
    );
    if (explicit) {
      return explicit;
    }
  }

  const reference = `${input.query ?? ''} ${input.task ?? ''}`.trim().toLowerCase();
  if (!reference) {
    return opportunities.find((opportunity) => extractPlannerCandidates(opportunity).length > 0);
  }

  const ranked = opportunities
    .map((opportunity) => ({
      opportunity,
      score: scorePlannerOpportunity(opportunity, reference),
    }))
    .sort((left, right) => right.score - left.score);

  return (
    ranked.find((entry) => extractPlannerCandidates(entry.opportunity).length > 0)?.opportunity ??
    opportunities.find((opportunity) => extractPlannerCandidates(opportunity).length > 0)
  );
}

function scorePlannerOpportunity(opportunity: PlannerOpportunity, reference: string): number {
  const haystack = [
    opportunity.id,
    opportunity.title,
    opportunity.reason,
    opportunity.role,
    ...(Array.isArray(opportunity.searchQueries) ? opportunity.searchQueries : []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();

  return reference
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function extractPlannerCandidates(opportunity: PlannerOpportunity): DelegateCandidate[] {
  if (!Array.isArray(opportunity.candidates)) {
    return [];
  }

  return opportunity.candidates
    .map((candidate) => plannerCandidateToDelegate(candidate))
    .filter((candidate): candidate is DelegateCandidate => candidate !== null);
}

function plannerCandidateToDelegate(candidate: unknown): DelegateCandidate | null {
  if (!isJsonRecord(candidate)) {
    return null;
  }

  const agent = isJsonRecord(candidate.agent) ? candidate.agent : candidate;
  const profile = isJsonRecord(agent.profile) ? agent.profile : undefined;
  const metadata = isJsonRecord(agent.metadata) ? agent.metadata : undefined;
  const uaid =
    readString(candidate.uaid) ??
    readString(agent.uaid) ??
    readString(agent.id);

  if (!uaid) {
    return null;
  }

  return {
    uaid,
    label:
      readString(candidate.label) ??
      readString(profile?.display_name) ??
      readString(profile?.alias) ??
      readString(agent.name) ??
      uaid,
    registry: readString(agent.registry),
    endpoint: readAgentEndpoint(agent),
    protocol: readString(metadata?.protocol) ?? readString(candidate.protocol),
    trustScore: readNumber(agent.trustScore) ?? readNumber(candidate.score),
    verified: readBoolean(candidate.verified),
    avgLatency: readNumber(candidate.avgLatency),
    available: readBoolean(metadata?.available),
    score: readNumber(candidate.score),
    communicationSupported:
      readBoolean(agent.communicationSupported) ?? readBoolean(candidate.communicationSupported),
    alias: readString(profile?.alias),
    provider: readString(metadata?.provider),
    searchText: [
      readString(profile?.display_name),
      readString(profile?.alias),
      readString(agent.name),
      readString(agent.description),
      readString(metadata?.delegationSummary),
    ]
      .filter((value): value is string => Boolean(value))
      .join(' '),
  };
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readAgentEndpoint(agent: Record<string, unknown>): string | undefined {
  if (!isJsonRecord(agent.endpoints)) {
    return undefined;
  }

  return (
    readString(agent.endpoints.primary) ??
    readString(agent.endpoints.api) ??
    readString(agent.endpoints.endpoint)
  );
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
