import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const brokerBaseUrl = readRequiredEnv('REGISTRY_BROKER_API_URL');
const brokerApiKey = readOptionalEnv('REGISTRY_BROKER_API_KEY');
const brokerTargetUaid = readRequiredEnv('REGISTRY_BROKER_E2E_UAID');
const brokerProbeMessage = readRequiredEnv('REGISTRY_BROKER_E2E_MESSAGE');
const brokerExpectedText = readRequiredEnv('REGISTRY_BROKER_E2E_EXPECT');

async function main(): Promise<void> {
  const transportEnv: Record<string, string> = {
    ...process.env,
    REGISTRY_BROKER_API_URL: brokerBaseUrl,
    REGISTRY_BROKER_E2E_UAID: brokerTargetUaid,
    REGISTRY_BROKER_E2E_MESSAGE: brokerProbeMessage,
    REGISTRY_BROKER_E2E_EXPECT: brokerExpectedText,
  } as Record<string, string>;

  if (brokerApiKey) {
    transportEnv.REGISTRY_BROKER_API_KEY = brokerApiKey;
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/cli.cjs', 'up', '--transport', 'stdio'],
    cwd: projectRoot,
    env: transportEnv,
    stderr: 'pipe',
  });

  const client = new Client(
    {
      name: 'registry-broker-codex-plugin-e2e',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  );

  try {
    await client.connect(transport);

    const healthResult = await client.callTool({
      name: 'registryBroker.health',
      arguments: {},
    });
    assertContent(healthResult, '"apiKeyConfigured": true', 'health did not report broker configuration');

    const summonResult = await client.callTool({
      name: 'registryBroker.summonAgent',
      arguments: {
        task: 'Verify broker delegation to a caller-specified target agent.',
        uaid: brokerTargetUaid,
        limit: 1,
        mode: 'best-match',
        message: brokerProbeMessage,
      },
    });
    assertContent(
      summonResult,
      brokerExpectedText,
      'summonAgent did not return the expected delegated response',
    );

    const summonPayload = extractToolPayload<{
      enlisted?: Array<{
        response?: {
          sessionId?: string;
        };
      }>;
    }>(summonResult, 'registryBroker.summonAgent');
    const sessionId = summonPayload.enlisted?.[0]?.response?.sessionId;
    if (!sessionId) {
      throw new Error('summonAgent did not return a broker sessionId.');
    }

    const historyResult = await client.callTool({
      name: 'registryBroker.sessionHistory',
      arguments: {
        sessionId,
      },
    });
    assertContent(
      historyResult,
      brokerExpectedText,
      'sessionHistory did not include the expected delegated response',
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          uaid: brokerTargetUaid,
          sessionId,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
    await transport.close();
  }
}

function assertContent(
  result: Awaited<ReturnType<Client['callTool']>>,
  needle: string,
  failureMessage: string,
): void {
  const text = Array.isArray(result.content)
    ? result.content
        .map((entry) => ('text' in entry && typeof entry.text === 'string' ? entry.text : ''))
        .join('\n')
    : '';

  if (!text.includes(needle)) {
    throw new Error(failureMessage);
  }
}

function extractToolPayload<T>(
  result: Awaited<ReturnType<Client['callTool']>>,
  label: string,
): T {
  const text = Array.isArray(result.content)
    ? result.content
        .map((entry) => ('text' in entry && typeof entry.text === 'string' ? entry.text : ''))
        .join('\n')
    : '';
  const marker = `${label}:\n`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Missing payload marker for ${label}.`);
  }
  const payloadText = text.slice(markerIndex + marker.length);
  return JSON.parse(payloadText) as T;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRequiredEnv(name: string): string {
  const value = readOptionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
