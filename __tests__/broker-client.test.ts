import { describe, expect, it, vi } from 'vitest';
import {
  RegistryBrokerClient,
  RegistryBrokerError,
} from '../src/broker-client';

describe('registry broker client', () => {
  it('serializes search params into the public search endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hits: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new RegistryBrokerClient({
      baseUrl: 'https://hol.org/registry/api/v1',
      apiKey: 'test-key',
      fetchImpl,
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
    expect(url).toBe(
      'https://hol.org/registry/api/v1/search?q=typescript+review&limit=5&registries=openrouter&protocols=openrouter&verified=true&online=true&type=ai-agents',
    );
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('x-api-key')).toBe('test-key');
  });

  it('uses the broker chat history endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sessionId: 'session-1', history: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new RegistryBrokerClient({
      baseUrl: 'https://hol.org/registry/api/v1',
      fetchImpl,
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
    const client = new RegistryBrokerClient({
      baseUrl: 'https://hol.org/registry/api/v1',
      fetchImpl,
    });

    const request = client.resolveUaid('uaid:test');

    await expect(request).rejects.toBeInstanceOf(RegistryBrokerError);
    await expect(request).rejects.toMatchObject({
      status: 403,
      statusText: 'Forbidden',
    });
  });
});
