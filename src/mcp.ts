import { randomUUID } from 'node:crypto';
import { FastMCP } from 'fastmcp';
import type { Context } from 'fastmcp';
import type { z } from 'zod';
import { buildDelegationBrief, buildDelegationContext } from './brief';
import type { BrokerService } from './broker';
import { RegistryBrokerService } from './broker';
import { config } from './config';
import {
  computePlannerLimit,
  computeRankingPoolSize,
  findFallbackCandidates,
  preferReachableCandidates,
  safeInvoke,
  sendSequentially,
  sendToCandidate,
} from './delegation';
import {
  describePlannerSelection,
  formatCandidateShortlist,
  readPlannerAction,
  selectPlannerCandidates,
} from './planner';
import {
  buildDelegateMessage,
  inferDelegationType,
  isBrokerAuthError,
  normalizeAgenticFilter,
  type DelegateCandidate,
} from './ranking';
import {
  delegateSchema,
  chatEndSchema,
  chatReadinessSchema,
  chatRetrySchema,
  searchSchema,
  sessionHistorySchema,
  summonSchema,
} from './tool-contracts';
import {
  buildDelegateNextAction,
  buildSummonNextAction,
  describeSessionHistorySummary,
  resultWithPayload,
  summarizeSessionHistory,
  type ToolResult,
} from './tool-results';
import { logger } from './logger';

type SessionAuth = Record<string, unknown> | undefined;

const instructions = [
  'For medium or large tasks, use registryBroker.delegate early to discover where specialist help would actually add leverage.',
  'Use registryBroker.summonAgent for bounded subtasks where a broker specialist can add value without taking over the whole user request.',
  'Use registryBroker.findAgents when you need to inspect the shortlist, explain the ranking, or let the user choose the target agent.',
  'Prefer best-match when one strong answer is enough, fallback when resilience matters, and parallel only when comparing approaches is worth the extra latency.',
  'Use dryRun on registryBroker.summonAgent when you want the exact dispatch plan before sending.',
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
     | typeof chatEndSchema
     | typeof chatReadinessSchema
     | typeof chatRetrySchema
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
        const plannerContext = buildPlannerContext(input);
        const delegationBrief = buildDelegationBrief({
          task: input.task,
          context: input.context,
          deliverable: input.deliverable,
          constraints: input.constraints,
          mustInclude: input.mustInclude,
          acceptanceCriteria: input.acceptanceCriteria,
        });

        logger.info({ requestId, tool: 'registryBroker.delegate' }, 'tool.invoke');

        const result = await service.delegate({
          task: input.task,
          context: plannerContext,
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

        const plannerSelection = selectPlannerCandidates(result, {
          task: input.task,
          query: plannerContext,
        });
        const nextAction = buildDelegateNextAction(plannerSelection, {
          task: input.task,
        });
        const opportunityCount =
          typeof result === 'object' &&
          result !== null &&
          Array.isArray((result as { opportunities?: unknown[] }).opportunities)
            ? (result as { opportunities?: unknown[] }).opportunities!.length
            : 0;

        return resultWithPayload(
          [
            `Delegation opportunities: ${opportunityCount}`,
            ...describePlannerSelection(plannerSelection, {
              includeRecommendedCandidate: true,
              includeSelectedOpportunity: true,
            }),
            `Next action: ${String(nextAction.type)}`,
          ].join('\n'),
          'registryBroker.delegate',
          {
            delegationBrief,
            nextAction,
            planner: result,
          },
        );
      },
    },
    {
      name: 'registryBroker.chatReadiness',
      description: 'Check whether a broker agent route can support chat before opening a session.',
      parameters: chatReadinessSchema,
      annotations: {
        title: 'Registry Broker Chat Readiness',
        readOnlyHint: true,
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = chatReadinessSchema.parse(args);
        if (!input.uaid && !input.agentUrl) {
          return resultWithPayload(
            'Provide either uaid or agentUrl.',
            'registryBroker.chatReadiness',
            { error: 'uaid_or_agent_url_required' },
          );
        }

        logger.info({ requestId, tool: 'registryBroker.chatReadiness' }, 'tool.invoke');
        const readiness = await service.checkChatReadiness(input);
        logger.info({ requestId, tool: 'registryBroker.chatReadiness' }, 'tool.success');

        return resultWithPayload(
          'Chat readiness checked.',
          'registryBroker.chatReadiness',
          { readiness },
        );
      },
    },
    {
      name: 'registryBroker.retryMessage',
      description: 'Retry a broker chat message by persisted message/idempotency key.',
      parameters: chatRetrySchema,
      annotations: {
        title: 'Registry Broker Retry Message',
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = chatRetrySchema.parse(args);
        logger.info({ requestId, tool: 'registryBroker.retryMessage' }, 'tool.invoke');
        const response = await service.retryMessage(input.messageId, {
          sessionId: input.sessionId,
          message: input.message,
          uaid: input.uaid,
          agentUrl: input.agentUrl,
          idempotencyKey: input.idempotencyKey,
        });
        logger.info({ requestId, tool: 'registryBroker.retryMessage' }, 'tool.success');

        return resultWithPayload(
          'Chat message retry completed.',
          'registryBroker.retryMessage',
          { sessionId: input.sessionId, response },
        );
      },
    },
    {
      name: 'registryBroker.cancelSession',
      description: 'Cancel a broker chat session and return its terminal state.',
      parameters: chatEndSchema,
      annotations: {
        title: 'Registry Broker Cancel Session',
        destructiveHint: true,
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = chatEndSchema.parse(args);
        logger.info({ requestId, tool: 'registryBroker.cancelSession' }, 'tool.invoke');
        const session = await service.cancelSession(input.sessionId);
        logger.info({ requestId, tool: 'registryBroker.cancelSession' }, 'tool.success');

        return resultWithPayload(
          `Cancelled chat session ${input.sessionId}.`,
          'registryBroker.cancelSession',
          { session },
        );
      },
    },
    {
      name: 'registryBroker.endSession',
      description: 'End a broker chat session and return its terminal state.',
      parameters: chatEndSchema,
      annotations: {
        title: 'Registry Broker End Session',
        destructiveHint: true,
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = chatEndSchema.parse(args);
        logger.info({ requestId, tool: 'registryBroker.endSession' }, 'tool.invoke');
        const session = await service.endSession(input.sessionId);
        logger.info({ requestId, tool: 'registryBroker.endSession' }, 'tool.success');

        return resultWithPayload(
          `Ended chat session ${input.sessionId}.`,
          'registryBroker.endSession',
          { session },
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
        const plannerContext = buildPlannerContext(input);
        const task = input.task;
        const query = input.query;
        const taskText = [task, query, plannerContext].filter((value): value is string => Boolean(value)).join('\n');
        const delegationBrief = task
          ? buildDelegationBrief({
              task,
              context: input.context,
              deliverable: input.deliverable,
              constraints: input.constraints,
              mustInclude: input.mustInclude,
              acceptanceCriteria: input.acceptanceCriteria,
            })
          : undefined;

        logger.info({ requestId, tool: 'registryBroker.findAgents' }, 'tool.invoke');

        const planResult = task
          ? await safeInvoke(() =>
              service.delegate({
                task,
                context: plannerContext,
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
                  candidate.suggestedMessage ??
                  buildDelegateMessage(delegationBrief ?? task ?? query, candidate),
              })),
              input.limit,
              Math.min(
                computeRankingPoolSize(taskText, input.limit),
                plannerSelection.candidates.length,
              ),
            )
          : shouldFallbackToSearch
            ? await findFallbackCandidates(service, query, {
                task: delegationBrief ?? task,
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

        const nextAction = buildFindAgentsNextAction(
          recommendationAction,
          shortlist,
          createSuggestedSummonArgs({
            task: task ?? query,
            query,
            briefSource: input,
          }),
        );

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
            `Next action: ${String(nextAction.type)}`,
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
            delegationBrief,
            nextAction,
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
      description:
        'Discover the strongest broker candidate for a subtask, message it, and return the broker session result.',
      parameters: summonSchema,
      annotations: {
        title: 'Registry Broker Summon Agent',
        destructiveHint: true,
      },
      execute: async (args, context) => {
        const requestId = context?.requestId ?? randomUUID();
        const input = summonSchema.parse(args);
        const query = input.query ?? input.task;
        const plannerContext = buildPlannerContext(input);
        const delegationBrief = buildDelegationBrief({
          task: input.task,
          context: input.context,
          deliverable: input.deliverable,
          constraints: input.constraints,
          mustInclude: input.mustInclude,
          acceptanceCriteria: input.acceptanceCriteria,
        });
        const taskText = [delegationBrief, query].filter((value): value is string => Boolean(value)).join('\n');
        const desiredCandidateCount = input.mode === 'best-match' ? 1 : input.limit;

        logger.info({ requestId, tool: 'registryBroker.summonAgent' }, 'tool.invoke');

        const directTarget = input.agentUrl
          ? { uaid: input.uaid ?? input.agentUrl, label: input.uaid ?? input.agentUrl }
          : undefined;

        const planResult = input.uaid || directTarget
          ? undefined
          : await safeInvoke(() =>
              service.delegate({
                task: input.task,
                context: plannerContext,
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
          !input.uaid && !directTarget && planResult?.value !== undefined
            ? selectPlannerCandidates(planResult.value, {
                task: input.task,
                query,
                opportunityId: input.opportunityId,
              })
            : undefined;
        const recommendationAction = readPlannerAction(plannerSelection?.recommendation);
        const shouldFallbackToSearch =
          !input.uaid &&
          !directTarget &&
          (plannerSelection === undefined ||
            (recommendationAction === undefined && plannerSelection.candidates.length === 0) ||
            (recommendationAction === 'delegate-now' && plannerSelection.candidates.length === 0) ||
            (recommendationAction === 'review-shortlist' && plannerSelection.candidates.length === 0));

        if (!input.uaid && !directTarget && recommendationAction === 'handle-locally') {
          const nextAction = buildDelegateNextAction(plannerSelection, {
            task: input.task,
            query,
            mode: input.mode,
          });

          logger.info(
            { requestId, tool: 'registryBroker.summonAgent', recommendationAction },
            'tool.short_circuit',
          );

          return resultWithPayload(
            [
              ...describePlannerSelection(plannerSelection, {
                includeSelectedOpportunity: true,
              }),
              `Next action: ${String(nextAction.type)}`,
              'No broker summon attempted.',
            ].join('\n'),
            'registryBroker.summonAgent',
            {
              strategy: 'broker-plan',
              query,
              task: input.task,
              delegationBrief,
              dryRun: input.dryRun,
              nextAction,
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
          !directTarget &&
          recommendationAction === 'review-shortlist' &&
          plannerSelection &&
          plannerSelection.candidates.length > 0
        ) {
          const shortlist = await preferReachableCandidates(
            service,
            plannerSelection.candidates,
            Math.min(input.limit, plannerSelection.candidates.length),
            Math.min(
              computeRankingPoolSize(taskText, input.limit),
              plannerSelection.candidates.length,
            ),
          );
          const nextAction = buildFindAgentsNextAction(
            recommendationAction,
            shortlist,
            createSuggestedSummonArgs({
              task: input.task,
              query,
              briefSource: input,
            }),
          );

          logger.info(
            { requestId, tool: 'registryBroker.summonAgent', recommendationAction },
            'tool.short_circuit',
          );

          return resultWithPayload(
            [
              ...describePlannerSelection(plannerSelection, {
                includeSelectedOpportunity: true,
              }),
              `Next action: ${String(nextAction.type)}`,
              'Review these broker candidates before summoning:',
              ...formatCandidateShortlist(shortlist),
            ].join('\n'),
            'registryBroker.summonAgent',
            {
              strategy: 'broker-plan',
              query,
              task: input.task,
              delegationBrief,
              dryRun: input.dryRun,
              nextAction,
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

        const rankedCandidates: Array<{ uaid: string; label: string; suggestedMessage?: string }> = directTarget
          ? [directTarget]
            : input.uaid
              ? [{ uaid: input.uaid, label: input.uaid }]
              : plannerSelection && plannerSelection.candidates.length > 0 && !shouldFallbackToSearch
                ? plannerSelection.candidates
                : await findFallbackCandidates(service, query, {
                    task: delegationBrief,
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
        const candidates = input.uaid || directTarget
          ? rankedCandidates
          : await preferReachableCandidates(
              service,
              rankedCandidates,
              desiredCandidateCount,
              Math.min(
                computeRankingPoolSize(taskText, desiredCandidateCount),
                rankedCandidates.length,
              ),
            );

        if (candidates.length === 0) {
          logger.warn({ requestId, tool: 'registryBroker.summonAgent' }, 'tool.no_candidates');
          return resultWithPayload(
            [
              ...describePlannerSelection(plannerSelection, {
                includeSelectedOpportunity: true,
              }),
              `No broker candidates were found for ${JSON.stringify(query)}.`,
            ].join('\n'),
            'registryBroker.summonAgent',
            {
              strategy:
                plannerSelection && plannerSelection.candidates.length > 0 && !shouldFallbackToSearch
                  ? 'broker-plan'
                  : 'search-fallback',
              query,
              task: input.task,
              delegationBrief,
              dryRun: input.dryRun,
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

        const chosen =
          input.mode === 'best-match' ? candidates.slice(0, 1) : candidates.slice(0, input.limit);
        const dispatchPlan = chosen.map((candidate) => ({
          uaid: candidate.uaid,
          agentUrl: input.agentUrl,
          label: candidate.label,
          message:
            input.message ??
            candidate.suggestedMessage ??
            buildDelegateMessage(delegationBrief, candidate),
        }));

        if (input.dryRun) {
          const nextAction = buildSummonNextAction([], true);

          logger.info({ requestId, tool: 'registryBroker.summonAgent', dryRun: true }, 'tool.success');

          return resultWithPayload(
            [
              ...describePlannerSelection(plannerSelection, {
                includeRecommendedCandidate: recommendationAction === 'delegate-now',
                includeSelectedOpportunity: true,
              }),
              `Next action: ${String(nextAction.type)}`,
              'Dry run only. No broker message sent.',
              ...dispatchPlan.map(
                (entry, index) =>
                  `${index + 1}. ${entry.label} — ${entry.agentUrl ?? entry.uaid} (preview)`,
              ),
            ].join('\n'),
            'registryBroker.summonAgent',
            {
              strategy:
                plannerSelection && plannerSelection.candidates.length > 0 && !shouldFallbackToSearch
                  ? 'broker-plan'
                  : input.agentUrl
                    ? 'direct-agent-url'
                    : input.uaid
                      ? 'direct-uaid'
                      : 'search-fallback',
              query,
              task: input.task,
              delegationBrief,
              dryRun: true,
              nextAction,
              mode: input.mode,
              selectedOpportunity: plannerSelection?.selectedOpportunity,
              opportunities: plannerSelection?.opportunities,
              candidates,
              dispatchPlan,
              enlisted: [],
              planner: planResult
                ? planResult.error
                  ? { error: planResult.error }
                  : planResult.value
                : undefined,
            },
          );
        }

        const enlisted =
          input.mode === 'parallel'
            ? await Promise.all(
                chosen.map((candidate) =>
                  sendToCandidate(service, candidate, {
                    task: input.task,
                    brief: delegationBrief,
                    message: input.message,
                    streaming: input.streaming,
                    agentUrl: input.agentUrl,
                    mode: input.mode,
                    limit: input.limit,
                  }),
                ),
              )
            : await sendSequentially(service, chosen, {
                task: input.task,
                brief: delegationBrief,
                message: input.message,
                streaming: input.streaming,
                agentUrl: input.agentUrl,
                mode: input.mode,
                limit: input.limit,
              });

        const successCount = enlisted.filter((entry) => entry.status === 'ok').length;
        const authBlocked = enlisted.some(
          (entry) => entry.status === 'error' && entry.error && isBrokerAuthError(entry.error),
        );
        const nextAction = buildSummonNextAction(enlisted, false);

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
            `Next action: ${String(nextAction.type)}`,
            authBlocked
              ? 'Broker auth is required for chat. Set REGISTRY_BROKER_API_KEY and retry.'
              : undefined,
            ...enlisted.map(
              (entry, index) =>
                `${index + 1}. ${entry.label} — ${entry.agentUrl ?? entry.uaid} (${entry.status})`,
            ),
          ]
            .filter(Boolean)
            .join('\n'),
          'registryBroker.summonAgent',
          {
            strategy:
              plannerSelection && plannerSelection.candidates.length > 0 && !shouldFallbackToSearch
                ? 'broker-plan'
                : input.agentUrl
                  ? 'direct-agent-url'
                  : input.uaid
                    ? 'direct-uaid'
                    : 'search-fallback',
            query,
            task: input.task,
            delegationBrief,
            dryRun: false,
            nextAction,
            mode: input.mode,
            selectedOpportunity: plannerSelection?.selectedOpportunity,
            opportunities: plannerSelection?.opportunities,
            candidates,
            dispatchPlan,
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
        const summary = summarizeSessionHistory(history);
        logger.info({ requestId, tool: 'registryBroker.sessionHistory' }, 'tool.success');

        return resultWithPayload(
          [
            `Fetched history for session ${input.sessionId}.`,
            ...describeSessionHistorySummary(summary),
          ].join('\n'),
          'registryBroker.sessionHistory',
          {
            sessionId: input.sessionId,
            summary,
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

function buildPlannerContext(input: {
  context?: string;
  deliverable?: string;
  constraints?: string[];
  mustInclude?: string[];
  acceptanceCriteria?: string[];
}): string | undefined {
  return buildDelegationContext({
    context: input.context,
    deliverable: input.deliverable,
    constraints: input.constraints,
    mustInclude: input.mustInclude,
    acceptanceCriteria: input.acceptanceCriteria,
  });
}

function createSuggestedSummonArgs(input: {
  task: string;
  query: string;
  briefSource: {
    deliverable?: string;
    constraints?: string[];
    mustInclude?: string[];
    acceptanceCriteria?: string[];
  };
}): Record<string, unknown> {
  const args: Record<string, unknown> = {
    task: input.task,
    query: input.query,
    mode: 'best-match',
    limit: 1,
  };

  if (input.briefSource.deliverable) {
    args.deliverable = input.briefSource.deliverable;
  }
  if (input.briefSource.constraints) {
    args.constraints = input.briefSource.constraints;
  }
  if (input.briefSource.mustInclude) {
    args.mustInclude = input.briefSource.mustInclude;
  }
  if (input.briefSource.acceptanceCriteria) {
    args.acceptanceCriteria = input.briefSource.acceptanceCriteria;
  }

  return args;
}

function buildFindAgentsNextAction(
  recommendationAction: ReturnType<typeof readPlannerAction>,
  shortlist: DelegateCandidate[],
  suggestedArgs: Record<string, unknown>,
): Record<string, unknown> {
  const lead = shortlist[0];
  if (lead) {
    return {
      type:
        recommendationAction === 'review-shortlist' ? 'review-shortlist' : 'summon-agent',
      tool: 'registryBroker.summonAgent',
      suggestedArgs: {
        ...suggestedArgs,
        uaid: lead.uaid,
      },
    };
  }

  if (recommendationAction === 'handle-locally') {
    return {
      type: 'handle-locally',
    };
  }

  return {
    type: 'inspect-results',
  };
}
