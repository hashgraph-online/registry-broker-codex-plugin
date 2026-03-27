import {
  RegistryBrokerClient,
  RegistryBrokerError,
  type SearchParams,
  type SearchResult,
  type SendMessageRequestPayload,
  type SendMessageResponse,
} from '@hashgraphonline/standards-sdk';
import { config } from './config';

export interface AgenticSearchRequest {
  query: string;
  limit: number;
  offset?: number;
  filter?: Record<string, unknown>;
}

export interface DelegationWorkspaceInput {
  openFiles?: string[];
  modifiedFiles?: string[];
  relatedPaths?: string[];
  errors?: string[];
  commands?: string[];
  languages?: string[];
}

export interface BrokerService {
  search(input: SearchParams): Promise<SearchResult>;
  vectorSearch(query: string, limit: number): Promise<unknown>;
  agenticSearch(input: AgenticSearchRequest): Promise<unknown>;
  planDelegation(input: {
    task: string;
    context?: string;
    workspace?: DelegationWorkspaceInput;
    limit: number;
    filter?: Record<string, unknown>;
  }): Promise<unknown>;
  sendMessage(input: SendMessageRequestPayload): Promise<SendMessageResponse>;
  getHistory(sessionId: string): Promise<unknown>;
  stats(): Promise<unknown>;
  listProtocols(): Promise<unknown>;
  resolveUaid(uaid: string): Promise<unknown>;
}

export class RegistryBrokerService implements BrokerService {
  private readonly client: RegistryBrokerClient;

  constructor(client?: RegistryBrokerClient) {
    this.client =
      client ??
      new RegistryBrokerClient({
        baseUrl: normalizeBaseUrl(config.brokerBaseUrl),
        apiKey: config.brokerApiKey,
      });
  }

  search(input: SearchParams): Promise<SearchResult> {
    return this.client.search(input);
  }

  async vectorSearch(query: string, limit: number): Promise<unknown> {
    try {
      return await this.client.vectorSearch({ query, limit });
    } catch (error) {
      if (isUnsupported(error)) {
        return this.client.search({ q: query, limit });
      }
      throw error;
    }
  }

  async agenticSearch(input: AgenticSearchRequest): Promise<unknown> {
    try {
      return await this.client.requestJson('/search/agentic', {
        method: 'POST',
        body: {
          query: input.query,
          limit: input.limit,
          offset: input.offset ?? 0,
          ...(input.filter ? { filter: input.filter } : {}),
        },
        headers: {
          'content-type': 'application/json',
        },
      });
    } catch (error) {
      if (isUnsupported(error)) {
        return { hits: [] };
      }
      throw error;
    }
  }

  planDelegation(input: {
    task: string;
    context?: string;
    workspace?: DelegationWorkspaceInput;
    limit: number;
    filter?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.client.requestJson('/search/delegation-plan', {
      method: 'POST',
      body: {
        task: input.task,
        ...(input.context ? { context: input.context } : {}),
        ...(input.workspace ? { workspace: input.workspace } : {}),
        limit: input.limit,
        ...(input.filter ? { filter: input.filter } : {}),
      },
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  sendMessage(input: SendMessageRequestPayload): Promise<SendMessageResponse> {
    return this.client.chat.sendMessage(input);
  }

  getHistory(sessionId: string): Promise<unknown> {
    return this.client.chat.getHistory(sessionId);
  }

  stats(): Promise<unknown> {
    return this.client.stats();
  }

  listProtocols(): Promise<unknown> {
    return this.client.listProtocols();
  }

  resolveUaid(uaid: string): Promise<unknown> {
    return this.client.resolveUaid(uaid);
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function isUnsupported(error: unknown): boolean {
  if (error instanceof RegistryBrokerError) {
    return error.status === 404 || error.status === 405 || error.status === 501;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /404|405|501|not supported|not implemented/i.test(message);
}
