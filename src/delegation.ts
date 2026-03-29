import type { BrokerService } from './broker';
import {
  buildDelegateMessage,
  type DelegateCandidate,
  inferDelegationType,
  isBrokerAuthError,
  normalizeAgenticFilter,
  pickDelegateCandidates,
} from './ranking';

type SafeResult<T> = {
  value?: T;
  error?: string;
};

export type PlannerOpportunity = {
  id?: string;
  title?: string;
  reason?: string;
  role?: string;
  suggestedMode?: string;
  searchQueries?: string[];
  candidates?: unknown[];
};

export type PlannerRecommendation = {
  action?: string;
  confidence?: number;
  reason?: string;
  opportunityId?: string;
  candidate?: unknown;
};

export type PlannerSelection = {
  opportunities: PlannerOpportunity[];
  selectedOpportunity?: PlannerOpportunity;
  candidates: DelegateCandidate[];
  recommendation?: PlannerRecommendation;
};

export type SummonExecutionInput = {
  task: string;
  message?: string;
  streaming?: boolean;
  mode: 'best-match' | 'fallback' | 'parallel';
  limit: number;
};

export type SummonDispatchResult = {
  uaid: string;
  label: string;
  message: string;
  status: 'ok' | 'error';
  response?: unknown;
  error?: string;
};

type JsonRecord = Record<string, unknown>;

const plannerActions = new Set(['delegate-now', 'review-shortlist', 'handle-locally']);

export async function collectSearches(
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

export async function sendSequentially(
  service: BrokerService,
  candidates: Array<{ uaid: string; label: string; suggestedMessage?: string }>,
  input: SummonExecutionInput,
): Promise<SummonDispatchResult[]> {
  const results: SummonDispatchResult[] = [];

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

export async function sendToCandidate(
  service: BrokerService,
  candidate: { uaid: string; label: string; suggestedMessage?: string },
  input: SummonExecutionInput,
): Promise<SummonDispatchResult> {
  const message = input.message ?? candidate.suggestedMessage ?? buildDelegateMessage(input.task, candidate);
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

export async function preferReachableCandidates(
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

export async function safeInvoke<T>(callback: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    return { value: await callback() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function computeRankingPoolSize(taskText: string, limit: number): number {
  if (
    /\b(code|coding|debug|bug|typescript|javascript|patch|refactor|implement|developer|software)\b/i.test(
      taskText,
    )
  ) {
    return 60;
  }

  return Math.max(20, limit * 8);
}

export function computePlannerLimit(limit: number): number {
  return Math.min(Math.max(limit, 3), 5);
}

export async function findFallbackCandidates(
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
    suggestedMessage: candidate.suggestedMessage ?? buildDelegateMessage(filters.task ?? query, candidate),
  }));

  return preferReachableCandidates(
    service,
    candidates,
    filters.limit,
    Math.min(rankingPoolSize, candidates.length),
  );
}

export function selectPlannerCandidates(
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
  if (opportunities.length === 0 && !isJsonRecord(payload.recommendation)) {
    return undefined;
  }

  const recommendation = isJsonRecord(payload.recommendation)
    ? (payload.recommendation as PlannerRecommendation)
    : undefined;
  const selectedOpportunity = selectPlannerOpportunity(opportunities, input, recommendation);
  const candidates = selectedOpportunity ? extractPlannerCandidates(selectedOpportunity) : [];
  const directCandidate = recommendation?.candidate
    ? plannerCandidateToDelegate(recommendation.candidate)
    : undefined;

  if (readPlannerAction(recommendation) === 'delegate-now') {
    return {
      opportunities,
      selectedOpportunity,
      candidates: directCandidate ? [directCandidate, ...candidates.filter((candidate) => candidate.uaid !== directCandidate.uaid)] : candidates,
      recommendation,
    };
  }

  return {
    opportunities,
    selectedOpportunity,
    candidates,
    recommendation,
  };
}

export function readPlannerAction(
  recommendation?: PlannerRecommendation,
): 'delegate-now' | 'review-shortlist' | 'handle-locally' | undefined {
  return recommendation && plannerActions.has(recommendation.action ?? '')
    ? (recommendation.action as 'delegate-now' | 'review-shortlist' | 'handle-locally')
    : undefined;
}

export function isPlannerFallbackRequired(selection?: PlannerSelection): boolean {
  const action = readPlannerAction(selection?.recommendation);
  if (!action) {
    return true;
  }
  if (action === 'handle-locally') {
    return false;
  }
  return selection?.candidates.length === 0;
}

export function describePlannerSelection(
  selection?: PlannerSelection,
  options?: {
    includeRecommendedCandidate?: boolean;
    includeSelectedOpportunity?: boolean;
  },
): string[] {
  const lines: string[] = [];
  const action = readPlannerAction(selection?.recommendation);

  if (action) {
    lines.push(`Recommendation: ${action}`);
  }

  const reason =
    readString(selection?.recommendation?.reason) ?? readString(selection?.selectedOpportunity?.reason);
  if (reason) {
    lines.push(`Reason: ${reason}`);
  }

  if (options?.includeSelectedOpportunity) {
    const selectedOpportunity =
      readString(selection?.selectedOpportunity?.id) ?? readString(selection?.selectedOpportunity?.title);
    if (selectedOpportunity) {
      lines.push(`Selected opportunity: ${selectedOpportunity}`);
    }
  }

  if (options?.includeRecommendedCandidate) {
    const candidate = getRecommendedCandidate(selection);
    if (candidate) {
      lines.push(`Recommended candidate: ${candidate.label}`);
    }
  }

  return lines;
}

export function formatCandidateShortlist(candidates: Array<{ uaid: string; label: string }>): string[] {
  return candidates.map((candidate, index) => `${index + 1}. ${candidate.label} — ${candidate.uaid}`);
}

function getRecommendedCandidate(selection?: PlannerSelection): DelegateCandidate | undefined {
  if (selection?.recommendation?.candidate) {
    return plannerCandidateToDelegate(selection.recommendation.candidate) ?? selection.candidates[0];
  }

  return selection?.candidates[0];
}

function selectPlannerOpportunity(
  opportunities: PlannerOpportunity[],
  input: {
    task?: string;
    query?: string;
    opportunityId?: string;
  },
  recommendation?: PlannerRecommendation,
): PlannerOpportunity | undefined {
  const preferredOpportunityId = input.opportunityId ?? recommendation?.opportunityId;

  if (preferredOpportunityId) {
    const explicit = opportunities.find((opportunity) => opportunity.id === preferredOpportunityId);
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
  const uaid = readString(candidate.uaid) ?? readString(agent.uaid) ?? readString(agent.id);

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
    suggestedMessage: readString(candidate.suggestedMessage) ?? readString(candidate.suggested_message),
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

function isResolvedCandidate(value: unknown): boolean {
  if (!isJsonRecord(value)) {
    return false;
  }

  if (isJsonRecord(value.agent)) {
    return true;
  }

  return typeof value.uaid === 'string' && value.uaid.trim().length > 0;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
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

function readAgentEndpoint(agent: JsonRecord): string | undefined {
  if (!isJsonRecord(agent.endpoints)) {
    return undefined;
  }

  return (
    readString(agent.endpoints.primary) ??
    readString(agent.endpoints.api) ??
    readString(agent.endpoints.endpoint)
  );
}
