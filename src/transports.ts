import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { config } from './config';
import { logger } from './logger';
import { createMcpServer } from './mcp';

const loopback = '127.0.0.1';

export async function runStdio(): Promise<void> {
  const server = createMcpServer();
  logger.info('Starting stdio transport');
  await server.start({ transportType: 'stdio' });
}

export async function runHttp(): Promise<void> {
  const server = createMcpServer();
  const upstreamPort = config.httpPort ?? config.port + 1;

  await server.start({
    transportType: 'httpStream',
    httpStream: {
      port: upstreamPort,
      host: loopback,
      endpoint: '/mcp/stream',
      enableJsonResponse: false,
    },
  });

  const gateway = http.createServer((request, response) =>
    handleGatewayRequest(request, response, upstreamPort),
  );

  await new Promise<void>((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(config.port, () => resolve());
  });
}

function handleGatewayRequest(
  request: IncomingMessage,
  response: ServerResponse,
  upstreamPort: number,
): void {
  if (!request.url) {
    response.writeHead(400).end('Missing URL');
    return;
  }

  const proxyRequest = http.request(
    {
      hostname: loopback,
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: `${loopback}:${upstreamPort}`,
      },
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    },
  );

  proxyRequest.on('error', (error) => {
    logger.error({ error }, 'proxy.error');
    if (!response.headersSent) {
      response.writeHead(502);
    }
    response.end('Upstream error');
  });

  if (request.method && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const tee = new PassThrough();
    request.pipe(tee).pipe(proxyRequest);
    return;
  }

  request.pipe(proxyRequest);
}
