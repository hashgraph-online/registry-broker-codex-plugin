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

type JsonRecord = Record<string, unknown>;

export type SummonExecutionInput = {
  task: string;
  brief: string;
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
  const message =
    input.message ?? candidate.suggestedMessage ?? buildDelegateMessage(input.brief, candidate);
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
    suggestedMessage:
      candidate.suggestedMessage ?? buildDelegateMessage(filters.task ?? query, candidate),
  }));

  return preferReachableCandidates(
    service,
    candidates,
    filters.limit,
    Math.min(rankingPoolSize, candidates.length),
  );
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
