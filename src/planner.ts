import type { DelegateCandidate } from './ranking';

type JsonRecord = Record<string, unknown>;

const plannerActions = new Set(['delegate-now', 'review-shortlist', 'handle-locally']);

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
      candidates: directCandidate
        ? [
            directCandidate,
            ...candidates.filter((candidate) => candidate.uaid !== directCandidate.uaid),
          ]
        : candidates,
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
      readString(selection?.selectedOpportunity?.id) ??
      readString(selection?.selectedOpportunity?.title);
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

export function formatCandidateShortlist(
  candidates: Array<{ uaid: string; label: string }>,
): string[] {
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
    suggestedMessage:
      readString(candidate.suggestedMessage) ?? readString(candidate.suggested_message),
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
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
