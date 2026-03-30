import type { PlannerSelection } from './planner';
import {
  isJsonRecord,
  readJsonRecord,
  readNumber,
  readString,
  type JsonRecord,
} from './value-readers';

export type TextContent = {
  type: 'text';
  text: string;
};

export type ToolResult = {
  content: TextContent[];
};

export type SessionHistorySummary = {
  messageCount: number;
  latestRole?: string;
  latestText?: string;
  historyTtlSeconds?: number;
};

export function resultWithPayload(summary: string, label: string, payload: unknown): ToolResult {
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

export function buildDelegateNextAction(
  selection: PlannerSelection | undefined,
  input: {
    task: string;
    query?: string;
    mode?: 'best-match' | 'fallback' | 'parallel';
  },
): Record<string, unknown> {
  const action = selection?.recommendation?.action;
  const candidate = selection?.candidates[0];
  const suggestedArgs =
    candidate && action !== 'handle-locally'
      ? {
          task: input.task,
          ...(input.query ? { query: input.query } : {}),
          uaid: candidate.uaid,
          mode: input.mode ?? 'best-match',
          limit: 1,
        }
      : undefined;

  switch (action) {
    case 'delegate-now':
      return {
        type: 'summon-agent',
        tool: 'registryBroker.summonAgent',
        suggestedArgs,
      };
    case 'review-shortlist':
      return {
        type: 'review-shortlist',
        tool: 'registryBroker.summonAgent',
        suggestedArgs,
      };
    default:
      return {
        type: 'handle-locally',
      };
  }
}

export function buildSummonNextAction(
  enlisted: Array<{ response?: unknown }>,
  dryRun: boolean,
): Record<string, unknown> {
  if (dryRun) {
    return {
      type: 'review-dispatch-plan',
    };
  }

  const sessionIds = Array.from(
    new Set(
      enlisted
        .map((entry) => readString(readJsonRecord(entry.response)?.sessionId))
        .filter((value): value is string => value !== undefined),
    ),
  );

  return {
    type: 'recover-session',
    tool: 'registryBroker.sessionHistory',
    sessionIds,
  };
}

export function summarizeSessionHistory(payload: unknown): SessionHistorySummary {
  const record = readJsonRecord(payload);
  const history = Array.isArray(record?.history)
    ? record.history.filter((entry): entry is JsonRecord => isJsonRecord(entry))
    : [];
  const latest = history.at(-1);
  const latestText = latest ? extractMessageText(latest) : undefined;

  return {
    messageCount: history.length,
    latestRole: readString(latest?.role),
    latestText,
    historyTtlSeconds: readNumber(record?.historyTtlSeconds),
  };
}

export function describeSessionHistorySummary(summary: SessionHistorySummary): string[] {
  return [
    `History messages: ${summary.messageCount}`,
    summary.latestRole ? `Latest role: ${summary.latestRole}` : undefined,
    summary.latestText ? `Latest reply: ${summary.latestText}` : undefined,
    typeof summary.historyTtlSeconds === 'number'
      ? `History TTL seconds: ${summary.historyTtlSeconds}`
      : undefined,
  ].filter((value): value is string => value !== undefined);
}

function extractMessageText(entry: JsonRecord): string | undefined {
  const direct = readString(entry.content) ?? readString(entry.message) ?? readString(entry.text);
  if (direct) {
    return toSingleLine(direct);
  }

  const content = entry.content;
  if (Array.isArray(content)) {
    const text = content
      .filter((value): value is JsonRecord => isJsonRecord(value))
      .map((value) => readString(value.text) ?? readString(value.content))
      .filter((value): value is string => value !== undefined)
      .join(' ');
    return text.length > 0 ? toSingleLine(text) : undefined;
  }

  return undefined;
}

function toSingleLine(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}
