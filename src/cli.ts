import { config } from './config';
import { logger } from './logger';
import { runHttp, runStdio } from './transports';

type Transport = 'stdio' | 'http';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command !== 'up') {
  process.stderr.write(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

const flags = parseFlags(args.slice(1));
const transport = normalizeTransport(flags.transport);

if (!transport) {
  process.stderr.write('Unsupported transport. Use --transport stdio|http.\n');
  process.exit(1);
}

void startServer(transport);

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: registry-broker-codex-plugin up [options]',
      '',
      'Options:',
      '  --transport <stdio|http>  Choose transport (default: stdio)',
      `  --port <number>            Override HTTP gateway port (default: ${config.port})`,
      '  -h, --help                Show this help message',
      '',
    ].join('\n'),
  );
}

function parseFlags(values: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value) {
      continue;
    }
    if (!value.startsWith('--')) {
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
      continue;
    }

    parsed[key] = true;
  }

  return parsed;
}

function normalizeTransport(value: string | boolean | undefined): Transport | null {
  const normalized = String(value ?? 'stdio').trim().toLowerCase();
  if (normalized === 'stdio' || normalized === 'http') {
    return normalized;
  }
  return null;
}

async function startServer(transport: Transport): Promise<void> {
  try {
    logger.info({ transport }, 'server.start');
    if (transport === 'stdio') {
      await runStdio();
      return;
    }
    await runHttp();
  } catch (error) {
    logger.error({ error }, 'server.failure');
    process.exit(1);
  }
}
