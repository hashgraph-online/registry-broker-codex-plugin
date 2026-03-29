import { randomUUID } from 'node:crypto';
import { FastMCP } from 'fastmcp';
import type { Context } from 'fastmcp';
import { z } from 'zod';
import type { BrokerService } from './broker';
import { RegistryBrokerService } from './broker';
import { config } from './config';
import {
  computePlannerLimit,
  computeRankingPoolSize,
  describePlannerSelection,
  formatCandidateShortlist,
  findFallbackCandidates,
  readPlannerAction,
  preferReachableCandidates,
  safeInvoke,
  selectPlannerCandidates,
  sendSequentially,
  sendToCandidate,
} from './delegation';
import {
  buildDelegateMessage,
  inferDelegationType,
  isBrokerAuthError,
  normalizeAgenticFilter,
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

const delegateSchema = z.object({
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

const instructions = [
  'For medium or large tasks, use registryBroker.delegate early to discover where specialist help would actually add leverage.',
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

export function createToolDefinitions(
  service: BrokerService,
): Array<
  ToolDefinition<
    | typeof searchSchema
    | typeof delegateSchema
    | typeof summonSchema
    | typeof sessionHistorySchema
  >
> {
  return [
    {
      name: 'registryBroker.delegate',
      description: 'Turn a free-form task into ranked broker delegation opportunities.',
      parameters: delegateSchema,
      annotations: {
        title: 'Registry Broker Delegate',
        readOnlyHint: true,
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = delegateSchema.parse(args);
        logger.info({ requestId, tool: 'registryBroker.delegate' }, 'tool.invoke');

        const result = await service.delegate({
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

        logger.info({ requestId, tool: 'registryBroker.delegate' }, 'tool.success');

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
        const plannerSelection = selectPlannerCandidates(result, {
          task: input.task,
          query: input.context,
        });

        return resultWithPayload(
          [
            `Delegation opportunities: ${opportunityCount}`,
            recommendationAction ? `Recommendation: ${recommendationAction}` : undefined,
            ...describePlannerSelection(plannerSelection, {
              includeRecommendedCandidate: true,
              includeSelectedOpportunity: true,
            }).filter((line) => line !== `Recommendation: ${recommendationAction}`),
          ]
            .filter(Boolean)
            .join('\n'),
          'registryBroker.delegate',
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
              service.delegate({
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
        const recommendationAction = readPlannerAction(plannerSelection?.recommendation);
        const shouldUsePlannerShortlist =
          recommendationAction !== undefined &&
          recommendationAction !== 'handle-locally' &&
          plannerSelection !== undefined &&
          plannerSelection.candidates.length > 0;
        const shouldFallbackToSearch =
          !task ||
          plannerSelection === undefined ||
          (recommendationAction === undefined && plannerSelection.candidates.length === 0) ||
          (recommendationAction === 'delegate-now' && plannerSelection.candidates.length === 0) ||
          (recommendationAction === 'review-shortlist' && plannerSelection.candidates.length === 0) ||
          (recommendationAction === 'handle-locally' && plannerSelection.candidates.length === 0);
        const shortlist = shouldUsePlannerShortlist
          ? await preferReachableCandidates(
              service,
              plannerSelection.candidates.map((candidate) => ({
                ...candidate,
                suggestedMessage:
                  candidate.suggestedMessage ?? buildDelegateMessage(task ?? query, candidate),
              })),
              input.limit,
              Math.min(
                computeRankingPoolSize(taskText, input.limit),
                plannerSelection.candidates.length,
              ),
            )
          : shouldFallbackToSearch
            ? await findFallbackCandidates(service, query, {
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
              })
            : [];
        logger.info(
          { requestId, tool: 'registryBroker.findAgents', candidates: shortlist.length },
          'tool.success',
        );
        return resultWithPayload(
          [
            ...describePlannerSelection(plannerSelection, {
              includeRecommendedCandidate: recommendationAction === 'delegate-now',
              includeSelectedOpportunity: true,
            }),
            recommendationAction === 'handle-locally'
              ? 'Broker recommends local handling for this task.'
              : `Found ${shortlist.length} ranked candidates for ${JSON.stringify(query)}.`,
            ...(shortlist.length > 0
              ? formatCandidateShortlist(shortlist)
              : recommendationAction === 'handle-locally'
                ? []
                : ['No candidates matched the broker search results.']),
          ].join('\n'),
          'registryBroker.findAgents',
          {
            strategy:
              shouldUsePlannerShortlist || recommendationAction === 'handle-locally'
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
              service.delegate({
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
        const recommendationAction = readPlannerAction(plannerSelection?.recommendation);
        const shouldFallbackToSearch =
          !input.uaid &&
          (plannerSelection === undefined ||
            (recommendationAction === undefined && plannerSelection.candidates.length === 0) ||
            (recommendationAction === 'delegate-now' && plannerSelection.candidates.length === 0) ||
            (recommendationAction === 'review-shortlist' && plannerSelection.candidates.length === 0));

        if (!input.uaid && recommendationAction === 'handle-locally') {
          logger.info(
            { requestId, tool: 'registryBroker.summonAgent', recommendationAction },
            'tool.short_circuit',
          );
          return resultWithPayload(
            [
              ...describePlannerSelection(plannerSelection, {
                includeSelectedOpportunity: true,
              }),
              'No broker summon attempted.',
            ].join('\n'),
            'registryBroker.summonAgent',
            {
              strategy: 'broker-plan',
              query,
              task: input.task,
              mode: input.mode,
              selectedOpportunity: plannerSelection?.selectedOpportunity,
              opportunities: plannerSelection?.opportunities,
              candidates: [],
              enlisted: [],
              planner: planResult
                ? planResult.error
                  ? { error: planResult.error }
                  : planResult.value
                : undefined,
            },
          );
        }

        if (
          !input.uaid &&
          recommendationAction === 'review-shortlist' &&
          plannerSelection &&
          plannerSelection.candidates.length > 0
        ) {
          logger.info(
            { requestId, tool: 'registryBroker.summonAgent', recommendationAction },
            'tool.short_circuit',
          );
          const shortlist = await preferReachableCandidates(
            service,
            plannerSelection.candidates,
            Math.min(input.limit, plannerSelection.candidates.length),
            Math.min(
              computeRankingPoolSize(taskText, input.limit),
              plannerSelection.candidates.length,
            ),
          );

          return resultWithPayload(
            [
              ...describePlannerSelection(plannerSelection, {
                includeSelectedOpportunity: true,
              }),
              'Review these broker candidates before summoning:',
              ...formatCandidateShortlist(shortlist),
            ].join('\n'),
            'registryBroker.summonAgent',
            {
              strategy: 'broker-plan',
              query,
              task: input.task,
              mode: input.mode,
              selectedOpportunity: plannerSelection.selectedOpportunity,
              opportunities: plannerSelection.opportunities,
              candidates: shortlist,
              enlisted: [],
              planner: planResult
                ? planResult.error
                  ? { error: planResult.error }
                  : planResult.value
                : undefined,
            },
          );
        }

        const rankedCandidates = input.uaid
          ? [{ uaid: input.uaid, label: input.uaid }]
          : plannerSelection && plannerSelection.candidates.length > 0 && !shouldFallbackToSearch
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
            [
              ...describePlannerSelection(plannerSelection, {
                includeSelectedOpportunity: true,
              }),
              `No broker candidates were found for ${JSON.stringify(query)}.`,
            ]
              .filter(Boolean)
              .join('\n'),
            'registryBroker.summonAgent',
            {
              strategy:
                plannerSelection && plannerSelection.candidates.length > 0 && !shouldFallbackToSearch
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
            ...describePlannerSelection(plannerSelection, {
              includeRecommendedCandidate: recommendationAction === 'delegate-now',
              includeSelectedOpportunity: true,
            }),
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
              plannerSelection && plannerSelection.candidates.length > 0 && !shouldFallbackToSearch
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
