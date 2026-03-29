import { z } from 'zod';

const logLevels = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;

const envSchema = z.object({
  REGISTRY_BROKER_API_URL: z.string().url().default('https://hol.org/registry/api/v1'),
  REGISTRY_BROKER_API_KEY: z.string().min(1).optional(),
  REGISTRY_BROKER_PLUGIN_PORT: z.coerce.number().int().positive().default(3444),
  REGISTRY_BROKER_PLUGIN_HTTP_PORT: z.coerce.number().int().positive().optional(),
  REGISTRY_BROKER_PLUGIN_LOG_LEVEL: z.enum(logLevels).default('info'),
  MCP_SERVER_NAME: z.string().min(1).optional(),
});

function normalize(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const parsed = envSchema.parse({
  REGISTRY_BROKER_API_URL: normalize(process.env.REGISTRY_BROKER_API_URL),
  REGISTRY_BROKER_API_KEY: normalize(process.env.REGISTRY_BROKER_API_KEY),
  REGISTRY_BROKER_PLUGIN_PORT: normalize(process.env.REGISTRY_BROKER_PLUGIN_PORT),
  REGISTRY_BROKER_PLUGIN_HTTP_PORT: normalize(process.env.REGISTRY_BROKER_PLUGIN_HTTP_PORT),
  REGISTRY_BROKER_PLUGIN_LOG_LEVEL: normalize(process.env.REGISTRY_BROKER_PLUGIN_LOG_LEVEL),
  MCP_SERVER_NAME: normalize(process.env.MCP_SERVER_NAME),
});

export const config = {
  brokerBaseUrl: parsed.REGISTRY_BROKER_API_URL,
  brokerApiKey: parsed.REGISTRY_BROKER_API_KEY,
  port: parsed.REGISTRY_BROKER_PLUGIN_PORT,
  httpPort: parsed.REGISTRY_BROKER_PLUGIN_HTTP_PORT,
  logLevel: parsed.REGISTRY_BROKER_PLUGIN_LOG_LEVEL,
  serverName: parsed.MCP_SERVER_NAME ?? 'registryBroker',
};

export type AppConfig = typeof config;
