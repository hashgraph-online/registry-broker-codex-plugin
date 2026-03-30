import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RegistryBrokerClient,
  RegistryBrokerError,
} from '../src/broker-client';

describe('registry broker client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes search params into the public search endpoint', async () => {
    const fixtureApiKey = ['fixture', 'value'].join('-');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hits: [], total: 0, page: 1, limit: 5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const client = new RegistryBrokerClient({
      baseUrl: 'https://hol.org/registry/api/v1',
      apiKey: fixtureApiKey,
    });

    await client.search({
      q: 'typescript review',
      limit: 5,
      registries: ['openrouter'],
      protocols: ['openrouter'],
      verified: true,
      online: true,
      type: 'ai-agents',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://hol.org/registry/api/v1/search');
    expect(parsed.searchParams.get('q')).toBe('typescript review');
    expect(parsed.searchParams.get('limit')).toBe('5');
    expect(parsed.searchParams.get('registries')).toBe('openrouter');
    expect(parsed.searchParams.get('protocols')).toBe('openrouter');
    expect(parsed.searchParams.get('verified')).toBe('true');
    expect(parsed.searchParams.get('online')).toBe('true');
    expect(parsed.searchParams.get('type')).toBe('ai-agents');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('x-api-key')).toBe(fixtureApiKey);
  });

  it('uses the broker chat history endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sessionId: 'session-1', history: [], historyTtlSeconds: 900 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const client = new RegistryBrokerClient({
      baseUrl: 'https://hol.org/registry/api/v1',
    });

    await client.chat.getHistory('session-1');

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hol.org/registry/api/v1/chat/session/session-1/history');
  });

  it('raises a broker error for non-2xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const client = new RegistryBrokerClient({
      baseUrl: 'https://hol.org/registry/api/v1',
    });

    const request = client.resolveUaid('uaid:test');

    await expect(request).rejects.toBeInstanceOf(RegistryBrokerError);
    await expect(request).rejects.toMatchObject({
      status: 403,
      statusText: 'Forbidden',
    });
  });
});
