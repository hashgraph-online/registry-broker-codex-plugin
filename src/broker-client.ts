export interface SearchParams {
  q?: string;
  limit?: number;
  page?: number;
  registry?: string;
  registries?: string[];
  protocols?: string[];
  adapters?: string[];
  capabilities?: string[];
  minTrust?: number;
  verified?: boolean;
  online?: boolean;
  type?: 'ai-agents' | 'mcp-servers';
}

export interface SearchResult {
  hits: unknown[];
  total?: number;
  page?: number;
  limit?: number;
  [key: string]: unknown;
}

export interface SendMessageRequestPayload {
  uaid?: string;
  message: string;
  sessionId?: string;
  agentUrl?: string;
  streaming?: boolean;
  auth?: Record<string, unknown>;
}

export interface SendMessageResponse {
  sessionId?: string;
  message?: string;
  [key: string]: unknown;
}

export class RegistryBrokerError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;

  constructor(message: string, init: { status: number; statusText: string; body: unknown }) {
    super(message);
    this.name = 'RegistryBrokerError';
    this.status = init.status;
    this.statusText = init.statusText;
    this.body = init.body;
  }
}

type RequestConfig = {
  method: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
};

type RegistryBrokerClientOptions = {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type JsonRecord = Record<string, unknown>;

export class RegistryBrokerClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  readonly chat: {
    sendMessage: (payload: SendMessageRequestPayload) => Promise<SendMessageResponse>;
    getHistory: (sessionId: string) => Promise<unknown>;
  };

  constructor(options: RegistryBrokerClientOptions) {
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.chat = {
      sendMessage: (payload) => this.sendMessage(payload),
      getHistory: (sessionId) => this.getHistory(sessionId),
    };
  }

  async requestJson<T>(path: string, config: RequestConfig): Promise<T> {
    const response = await this.request(path, config);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new Error('Expected JSON response from registry broker');
    }
    return (await response.json()) as T;
  }

  search(params: SearchParams = {}): Promise<SearchResult> {
    const query = buildSearchQuery(params);
    return this.requestJson<SearchResult>(`/search${query}`, { method: 'GET' });
  }

  vectorSearch(request: { query: string; limit: number }): Promise<unknown> {
    return this.requestJson('/search', {
      method: 'POST',
      body: request,
      headers: { 'content-type': 'application/json' },
    });
  }

  resolveUaid(uaid: string): Promise<unknown> {
    return this.requestJson(`/resolve/${encodeURIComponent(uaid)}`, { method: 'GET' });
  }

  private sendMessage(payload: SendMessageRequestPayload): Promise<SendMessageResponse> {
    const body: JsonRecord = {
      message: payload.message,
    };

    if (payload.uaid) {
      body.uaid = payload.uaid;
    }
    if (payload.sessionId) {
      body.sessionId = payload.sessionId;
    }
    if (payload.agentUrl) {
      body.agentUrl = payload.agentUrl;
    }
    if (payload.streaming !== undefined) {
      body.streaming = payload.streaming;
    }
    if (payload.auth) {
      body.auth = payload.auth;
    }

    return this.requestJson<SendMessageResponse>('/chat/message', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    });
  }

  private getHistory(sessionId: string): Promise<unknown> {
    return this.requestJson(`/chat/session/${encodeURIComponent(sessionId)}/history`, {
      method: 'GET',
    });
  }

  private async request(path: string, config: RequestConfig): Promise<Response> {
    const headers = new Headers(config.headers);
    if (this.apiKey && !headers.has('x-api-key')) {
      headers.set('x-api-key', this.apiKey);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: config.method,
      headers,
      body: config.body === undefined ? undefined : JSON.stringify(config.body),
    });

    if (response.ok) {
      return response;
    }

    let body: unknown;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.toLowerCase().includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    throw new RegistryBrokerError('Registry broker request failed', {
      status: response.status,
      statusText: response.statusText,
      body,
    });
  }
}

function buildSearchQuery(params: SearchParams): string {
  const query = new URLSearchParams();

  setString(query, 'q', params.q);
  setNumber(query, 'limit', params.limit);
  setNumber(query, 'page', params.page);
  setString(query, 'registry', params.registry);
  setList(query, 'registries', params.registries);
  setList(query, 'protocols', params.protocols);
  setList(query, 'adapters', params.adapters);
  setList(query, 'capabilities', params.capabilities);
  setNumber(query, 'minTrust', params.minTrust);
  setBoolean(query, 'verified', params.verified);
  setBoolean(query, 'online', params.online);
  setString(query, 'type', params.type);

  const suffix = query.toString();
  return suffix.length > 0 ? `?${suffix}` : '';
}

function setString(query: URLSearchParams, key: string, value: string | undefined): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    query.set(key, value);
  }
}

function setNumber(query: URLSearchParams, key: string, value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    query.set(key, String(Math.trunc(value)));
  }
}

function setBoolean(query: URLSearchParams, key: string, value: boolean | undefined): void {
  if (value === true) {
    query.set(key, 'true');
  }
}

function setList(query: URLSearchParams, key: string, values: string[] | undefined): void {
  if (!Array.isArray(values) || values.length === 0) {
    return;
  }

  const filtered = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (filtered.length > 0) {
    query.set(key, filtered.join(','));
  }
}
