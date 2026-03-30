import { buildDelegationPrompt } from './brief';
import {
  isJsonRecord,
  readBoolean,
  readNumber,
  readString,
  type JsonRecord,
} from './value-readers';

export interface DelegateCandidate {
  uaid: string;
  label: string;
  suggestedMessage?: string;
  registry?: string;
  endpoint?: string;
  protocol?: string;
  trustScore?: number;
  verified?: boolean;
  avgLatency?: number;
  available?: boolean;
  score?: number;
  communicationSupported?: boolean;
  alias?: string;
  provider?: string;
  searchText?: string;
}

export interface DelegateCandidateFilters {
  limit: number;
  registries?: string[];
  minTrust?: number;
  verified?: boolean;
  online?: boolean;
  taskText?: string;
}

type SourceName = 'agentic' | 'vector' | 'keyword';

interface AggregateCandidate extends DelegateCandidate {
  firstSourceIndex: number;
  firstPosition: number;
  sourceRanks: Partial<Record<SourceName, number>>;
  sourceCount: number;
}

export function buildDelegateMessage(task: string, candidate: DelegateCandidate): string {
  return buildDelegationPrompt(
    {
      task,
    },
    candidate,
  );
}

export function inferDelegationType(text: string): 'ai-agents' | 'mcp-servers' {
  const normalized = text.toLowerCase();
  const mentionsMcp = normalized.includes('mcp');
  const mentionsServer =
    normalized.includes('server') ||
    normalized.includes('stdio') ||
    normalized.includes('sse');
  return mentionsMcp && mentionsServer ? 'mcp-servers' : 'ai-agents';
}

export function isBrokerAuthError(message: string): boolean {
  return (
    /\b401\b/.test(message) ||
    /\b403\b/.test(message) ||
    /\bauthorization required\b/i.test(message) ||
    /\bREGISTRY_BROKER_API_KEY\b/i.test(message)
  );
}

export function normalizeAgenticFilter(input: {
  registry?: string;
  registries?: string[];
  protocols?: string[];
  adapters?: string[];
  capabilities?: string[];
  minTrust?: number;
  verified?: boolean;
  online?: boolean;
  type?: 'ai-agents' | 'mcp-servers';
}): Record<string, unknown> | undefined {
  const record: Record<string, unknown> = {};
  const registries =
    input.registries?.filter((value) => value.trim().length > 0) ??
    (input.registry ? [input.registry] : undefined);

  if (registries?.length) {
    record.registries = registries;
  }
  if (input.protocols?.length) {
    record.protocols = input.protocols;
  }
  if (input.adapters?.length) {
    record.adapters = input.adapters;
  }
  if (input.capabilities?.length) {
    record.capabilities = input.capabilities;
  }
  if (typeof input.minTrust === 'number' && Number.isFinite(input.minTrust)) {
    record.minTrust = input.minTrust;
  }
  if (input.verified === true) {
    record.verifiedOnly = true;
  }
  if (input.online === true) {
    record.onlineOnly = true;
  }
  if (input.type) {
    record.type = input.type;
  }

  return Object.keys(record).length > 0 ? record : undefined;
}

export function pickDelegateCandidates(
  results: unknown[],
  filters: DelegateCandidateFilters,
): DelegateCandidate[] {
  const sourceNames: SourceName[] = ['agentic', 'vector', 'keyword'];
  const pool = new Map<string, AggregateCandidate>();

  results.forEach((result, sourceIndex) => {
    const sourceName = sourceNames[sourceIndex] ?? 'keyword';
    extractDelegateCandidates(result).forEach((candidate, position) => {
      if (!candidatePassesFilters(candidate, filters)) {
        return;
      }

      const existing = pool.get(candidate.uaid);
      if (!existing) {
        pool.set(candidate.uaid, {
          ...candidate,
          firstSourceIndex: sourceIndex,
          firstPosition: position,
          sourceRanks: { [sourceName]: position },
          sourceCount: 1,
        });
        return;
      }

      existing.label =
        preferredString(existing.label, candidate.label) ?? existing.label ?? candidate.label;
      existing.registry = preferredString(existing.registry, candidate.registry);
      existing.endpoint = preferredString(existing.endpoint, candidate.endpoint);
      existing.protocol = preferredString(existing.protocol, candidate.protocol);
      existing.alias = preferredString(existing.alias, candidate.alias);
      existing.provider = preferredString(existing.provider, candidate.provider);
      existing.searchText = preferredString(existing.searchText, candidate.searchText);
      existing.trustScore = preferredNumber(existing.trustScore, candidate.trustScore);
      existing.avgLatency = preferredLatency(existing.avgLatency, candidate.avgLatency);
      existing.score = preferredNumber(existing.score, candidate.score);
      existing.verified = existing.verified === true || candidate.verified === true;
      existing.available = existing.available === true || candidate.available === true;
      existing.communicationSupported =
        existing.communicationSupported === true || candidate.communicationSupported === true;
      existing.sourceRanks[sourceName] =
        existing.sourceRanks[sourceName] === undefined
          ? position
          : Math.min(existing.sourceRanks[sourceName] ?? position, position);
      existing.sourceCount = Object.keys(existing.sourceRanks).length;
    });
  });

  const ranked = Array.from(pool.values());

  ranked.sort((left, right) => {
    const scoreDiff =
      scoreDelegateCandidate(right, filters.taskText) -
      scoreDelegateCandidate(left, filters.taskText);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const trustDiff = (right.trustScore ?? -1) - (left.trustScore ?? -1);
    if (trustDiff !== 0) {
      return trustDiff;
    }

    const verifiedDiff = Number(Boolean(right.verified)) - Number(Boolean(left.verified));
    if (verifiedDiff !== 0) {
      return verifiedDiff;
    }

    const availabilityDiff = Number(Boolean(right.available)) - Number(Boolean(left.available));
    if (availabilityDiff !== 0) {
      return availabilityDiff;
    }

    const sourceDiff = left.firstSourceIndex - right.firstSourceIndex;
    if (sourceDiff !== 0) {
      return sourceDiff;
    }

    return left.firstPosition - right.firstPosition;
  });

  return ranked
    .slice(0, filters.limit)
    .map((entry) => ({
      uaid: entry.uaid,
      label: entry.label,
      registry: entry.registry,
      endpoint: entry.endpoint,
      protocol: entry.protocol,
      trustScore: entry.trustScore,
      verified: entry.verified,
      avgLatency: entry.avgLatency,
      available: entry.available,
      score: entry.score,
      communicationSupported: entry.communicationSupported,
      alias: entry.alias,
      provider: entry.provider,
      searchText: entry.searchText,
    }));
}

function extractDelegateCandidates(result: unknown): DelegateCandidate[] {
  if (!isJsonRecord(result)) {
    return [];
  }

  const hits = result.hits;
  if (!Array.isArray(hits)) {
    return [];
  }

  const candidates: DelegateCandidate[] = [];
  for (const hit of hits) {
    if (!isJsonRecord(hit)) {
      continue;
    }

    const agent = isJsonRecord(hit.agent) ? hit.agent : hit;
    const uaid = readString(agent.uaid) ?? readString(agent.id) ?? readString(hit.uaid);
    if (!uaid) {
      continue;
    }

    const profile = isJsonRecord(agent.profile)
      ? agent.profile
      : isJsonRecord(hit.profile)
        ? hit.profile
        : undefined;
    const displayName = profile ? readString(profile.display_name) : undefined;
    const alias = profile ? readString(profile.alias) : undefined;
    const registry = readString(agent.registry) ?? readString(hit.registry);
    const metadata = isJsonRecord(agent.metadata)
      ? agent.metadata
      : isJsonRecord(hit.metadata)
        ? hit.metadata
        : undefined;
    const provider = metadata ? readString(metadata.provider) : undefined;
    const searchText = [
      displayName,
      alias,
      readString(agent.name),
      readString(agent.description),
      metadata ? readString(metadata.delegationSummary) : undefined,
      metadata ? readStringArray(metadata.delegationTaskTags).join(' ') : undefined,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ');

    candidates.push({
      uaid,
      label: displayName ?? alias ?? registry ?? 'agent',
      registry,
      endpoint: readString(hit.endpoint) ?? readAgentEndpoint(agent),
      protocol: readString(hit.protocol) ?? readAgentProtocol(agent),
      trustScore: readNumber(hit.trustScore) ?? readAgentTrustScore(agent),
      verified: readBoolean(hit.verified) ?? readAgentVerified(agent),
      avgLatency: readNumber(hit.avgLatency) ?? readNumber(agent.avgLatency),
      available: readBoolean(hit.online) ?? readAgentAvailable(agent),
      score: readNumber(hit.score),
      communicationSupported: readBoolean(agent.communicationSupported),
      alias,
      provider,
      searchText: searchText.length > 0 ? searchText : undefined,
    });
  }

  return candidates;
}

function scoreDelegateCandidate(candidate: AggregateCandidate, taskText?: string): number {
  const trustScore = candidate.trustScore ?? 0;
  const verifiedBonus = candidate.verified ? 30 : 0;
  const availabilityBonus =
    candidate.available === true ? 50 : candidate.available === false ? -10 : 0;
  const communicationBonus =
    candidate.communicationSupported === true
      ? 200
      : candidate.communicationSupported === false
        ? -200
        : 0;
  const agenticScoreBonus =
    typeof candidate.score === 'number' && Number.isFinite(candidate.score)
      ? Math.min(100, candidate.score * 1000)
      : 0;
  const protocol = candidate.protocol?.toLowerCase();

  let protocolBonus = 0;
  if (protocol === 'xmtp' || protocol === 'a2a' || protocol === 'mcp') {
    protocolBonus = 50;
  }
  if (protocol === 'rest' || protocol === 'http') {
    protocolBonus = -100;
  }

  const sourceBonus = scoreSourceEvidence(candidate.sourceRanks, taskText);
  const overlapBonus = scoreTaskOverlap(candidate, taskText);
  const aliasBonus = scoreAliasBonus(candidate, taskText);
  const sourceCountBonus = Math.max(0, candidate.sourceCount - 1) * 35;

  return (
    trustScore +
    verifiedBonus +
    availabilityBonus +
    communicationBonus +
    agenticScoreBonus +
    protocolBonus +
    sourceBonus +
    overlapBonus +
    aliasBonus +
    sourceCountBonus
  );
}

function candidatePassesFilters(
  candidate: DelegateCandidate,
  filters: DelegateCandidateFilters,
): boolean {
  if (filters.registries?.length && (!candidate.registry || !filters.registries.includes(candidate.registry))) {
    return false;
  }
  if (typeof filters.minTrust === 'number' && (candidate.trustScore ?? -1) < filters.minTrust) {
    return false;
  }
  if (filters.verified === true && candidate.verified !== true) {
    return false;
  }
  if (filters.online === true && candidate.available !== true) {
    return false;
  }

  return true;
}

function readAgentEndpoint(agent: JsonRecord): string | undefined {
  const direct = readString(agent.endpoint);
  if (direct) {
    return direct;
  }

  const endpoints = agent.endpoints;
  if (Array.isArray(endpoints)) {
    for (const entry of endpoints) {
      if (!isJsonRecord(entry)) {
        continue;
      }

      const endpoint = readString(entry.endpoint) ?? readString(entry.url);
      if (endpoint) {
        return endpoint;
      }
    }
  }

  const profile = isJsonRecord(agent.profile) ? agent.profile : undefined;
  const mcpServer = profile && isJsonRecord(profile.mcpServer) ? profile.mcpServer : undefined;
  const connectionInfo =
    mcpServer && isJsonRecord(mcpServer.connectionInfo) ? mcpServer.connectionInfo : undefined;
  return connectionInfo ? readString(connectionInfo.url) : undefined;
}

function readAgentProtocol(agent: JsonRecord): string | undefined {
  const direct = readString(agent.protocol);
  if (direct) {
    return direct;
  }

  const metadata = isJsonRecord(agent.metadata) ? agent.metadata : undefined;
  return metadata ? readString(metadata.protocol) : undefined;
}

function readAgentTrustScore(agent: JsonRecord): number | undefined {
  const direct = readNumber(agent.trustScore);
  if (direct !== undefined) {
    return direct;
  }

  const trustScores = isJsonRecord(agent.trustScores) ? agent.trustScores : undefined;
  return trustScores ? readNumber(trustScores.total) : undefined;
}

function readAgentVerified(agent: JsonRecord): boolean | undefined {
  const direct = readBoolean(agent.verified);
  if (direct !== undefined) {
    return direct;
  }

  const metadata = isJsonRecord(agent.metadata) ? agent.metadata : undefined;
  return metadata ? readBoolean(metadata.verified) : undefined;
}

function readAgentAvailable(agent: JsonRecord): boolean | undefined {
  const direct = readBoolean(agent.available);
  if (direct !== undefined) {
    return direct;
  }

  const metadata = isJsonRecord(agent.metadata) ? agent.metadata : undefined;
  return metadata ? readBoolean(metadata.available) : undefined;
}

function preferredString(current: string | undefined, next: string | undefined): string | undefined {
  if (!next || next.trim().length === 0) {
    return current;
  }
  if (!current || current.trim().length === 0) {
    return next;
  }
  return current.length >= next.length ? current : next;
}

function preferredNumber(current: number | undefined, next: number | undefined): number | undefined {
  if (typeof next !== 'number' || !Number.isFinite(next)) {
    return current;
  }
  if (typeof current !== 'number' || !Number.isFinite(current)) {
    return next;
  }
  return Math.max(current, next);
}

function preferredLatency(current: number | undefined, next: number | undefined): number | undefined {
  if (typeof next !== 'number' || !Number.isFinite(next)) {
    return current;
  }
  if (typeof current !== 'number' || !Number.isFinite(current)) {
    return next;
  }
  return Math.min(current, next);
}

function scoreSourceEvidence(
  sourceRanks: Partial<Record<SourceName, number>>,
  taskText?: string,
): number {
  const codingTask = isCodingTask(taskText);
  const sourceWeights = codingTask
    ? {
        agentic: 70,
        vector: 40,
        keyword: 320,
      }
    : {
        agentic: 120,
        vector: 60,
        keyword: 140,
      };

  return Object.entries(sourceRanks).reduce((total, entry) => {
    const [sourceName, rank] = entry as [SourceName, number];
    const weight = sourceWeights[sourceName];
    return total + Math.max(0, weight - rank * 8);
  }, 0);
}

function scoreTaskOverlap(candidate: DelegateCandidate, taskText?: string): number {
  if (!taskText || !candidate.searchText) {
    return 0;
  }

  const haystack = normalizeText(candidate.searchText);
  if (haystack.length === 0) {
    return 0;
  }

  const taskTokens = tokenize(taskText);
  let matches = 0;
  for (const token of taskTokens) {
    if (haystack.includes(token)) {
      matches += 1;
    }
  }

  return Math.min(140, matches * 22);
}

function scoreAliasBonus(candidate: DelegateCandidate, taskText?: string): number {
  if (!isCodingTask(taskText)) {
    return 0;
  }

  const haystack = normalizeText(
    [candidate.label, candidate.alias, candidate.provider, candidate.searchText]
      .filter((value): value is string => typeof value === 'string')
      .join(' '),
  );

  let bonus = 0;
  if (haystack.includes('codex')) {
    bonus += 220;
  }
  if (haystack.includes('coder')) {
    bonus += 180;
  }
  if (haystack.includes('gpt 5 4')) {
    bonus += 140;
  }
  if (haystack.includes('gpt 5 3')) {
    bonus += 120;
  }

  return bonus;
}

function isCodingTask(taskText?: string): boolean {
  if (!taskText) {
    return false;
  }

  return /\b(code|coding|debug|bug|typescript|javascript|patch|refactor|implement|developer|software)\b/i.test(
    taskText,
  );
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

const STOP_WORDS = new Set([
  'this',
  'that',
  'with',
  'from',
  'into',
  'your',
  'have',
  'will',
  'would',
  'should',
  'could',
  'need',
  'help',
  'through',
  'while',
  'using',
  'then',
  'them',
  'their',
  'where',
  'what',
  'when',
]);
