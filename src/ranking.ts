export interface DelegateCandidate {
  uaid: string;
  label: string;
  registry?: string;
  endpoint?: string;
  protocol?: string;
  trustScore?: number;
  verified?: boolean;
  avgLatency?: number;
  available?: boolean;
  score?: number;
  communicationSupported?: boolean;
}

export interface DelegateCandidateFilters {
  limit: number;
  registries?: string[];
  minTrust?: number;
  verified?: boolean;
  online?: boolean;
}

type JsonRecord = Record<string, unknown>;

export function buildDelegateMessage(task: string, candidate: DelegateCandidate): string {
  const header =
    candidate.label && candidate.label !== 'agent'
      ? `${candidate.label} (${candidate.uaid})`
      : candidate.uaid;
  return [
    `Hi ${header},`,
    '',
    'Can you help with this focused subtask?',
    '',
    task,
    '',
    'Please respond with: (1) approach, (2) key pitfalls, (3) concrete steps or code if helpful.',
  ].join('\n');
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
  type?: 'ai-agents' | 'mcp-servers';
}): Record<string, unknown> | undefined {
  const record: Record<string, unknown> = {};
  const registry = input.registry ?? input.registries?.[0];

  if (registry) {
    record.registry = registry;
  }
  if (input.protocols?.length) {
    record.protocols = input.protocols;
  }
  if (input.adapters?.length) {
    record.adapter = input.adapters;
  }
  if (input.capabilities?.length) {
    record.capabilities = input.capabilities;
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
  const seen = new Set<string>();
  const pool: Array<DelegateCandidate & { sourceIndex: number; position: number }> = [];

  results.forEach((result, sourceIndex) => {
    extractDelegateCandidates(result).forEach((candidate, position) => {
      if (seen.has(candidate.uaid) || !candidatePassesFilters(candidate, filters)) {
        return;
      }

      seen.add(candidate.uaid);
      pool.push({ ...candidate, sourceIndex, position });
    });
  });

  pool.sort((left, right) => {
    const scoreDiff = scoreDelegateCandidate(right) - scoreDelegateCandidate(left);
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

    const sourceDiff = left.sourceIndex - right.sourceIndex;
    if (sourceDiff !== 0) {
      return sourceDiff;
    }

    return left.position - right.position;
  });

  return pool
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
    });
  }

  return candidates;
}

function scoreDelegateCandidate(candidate: DelegateCandidate): number {
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

  return (
    trustScore +
    verifiedBonus +
    availabilityBonus +
    communicationBonus +
    agenticScoreBonus +
    protocolBonus
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

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}
