import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const defaultPingAgentUaid =
  'uaid:aid:2vdWUw1Qd26QtfXomHZhSJb6x4Pd3r5MTYr82v9A15ua2ja8TiVTWZEFAg1rQ37gpW';
const holHostedBrokerBaseUrl = 'https://hol.org/registry/api/v1';
const brokerBaseUrl = readEnvOrDefault('REGISTRY_BROKER_API_URL', holHostedBrokerBaseUrl);
const isHolHostedBroker = brokerBaseUrl === holHostedBrokerBaseUrl;
const brokerApiKey = readOptionalEnv('REGISTRY_BROKER_API_KEY');
const registries = readOptionalListEnv('REGISTRY_BROKER_E2E_REGISTRIES');
const discoveryQuery =
  readOptionalEnv('REGISTRY_BROKER_E2E_DISCOVERY_QUERY') ??
  (!isHolHostedBroker ? 'registry ping agent' : undefined);
const discoveryExpectedUaid =
  readOptionalEnv('REGISTRY_BROKER_E2E_DISCOVERY_EXPECT_UAID') ??
  (!isHolHostedBroker ? defaultPingAgentUaid : undefined);
const delegationPlanExpectedUaid =
  readOptionalEnv('REGISTRY_BROKER_E2E_PLAN_EXPECT_UAID') ?? discoveryExpectedUaid;
const delegationPlanContext =
  readOptionalEnv('REGISTRY_BROKER_E2E_PLAN_CONTEXT') ??
  'Prefer a delegate-now recommendation for the local ping agent.';
const delegationPlanRecommendationAction =
  readOptionalEnv('REGISTRY_BROKER_E2E_PLAN_EXPECT_ACTION') ?? 'delegate-now';
const discoveryTask =
  readOptionalEnv('REGISTRY_BROKER_E2E_DISCOVERY_TASK') ??
  (!isHolHostedBroker
    ? 'Use the Registry Ping Agent to verify broker delegation end to end for the Codex plugin.'
    : undefined);
const delegationPlanWorkspace = {
  openFiles: ['src/mcp.ts', 'src/broker.ts'],
  modifiedFiles: ['src/mcp.ts'],
  relatedPaths: ['plugins/registry-broker'],
  errors: ['Need a broker delegate for this bounded verification task.'],
  commands: ['pnpm run e2e:broker'],
  languages: ['typescript'],
};
const discoveryLimit = readOptionalIntEnv('REGISTRY_BROKER_E2E_DISCOVERY_LIMIT') ?? 5;
const brokerTargetUaid =
  readOptionalEnv('REGISTRY_BROKER_E2E_UAID') ?? (!isHolHostedBroker ? defaultPingAgentUaid : undefined);
const brokerProbeMessage = readOptionalEnv('REGISTRY_BROKER_E2E_MESSAGE') ?? 'ping';
const brokerExpectedText = readOptionalEnv('REGISTRY_BROKER_E2E_EXPECT') ?? 'PONG';
const querySummonQuery = readOptionalEnv('REGISTRY_BROKER_E2E_QUERY_SUMMON_QUERY');
const querySummonTask =
  readOptionalEnv('REGISTRY_BROKER_E2E_QUERY_SUMMON_TASK') ??
  'Delegate a bounded verification prompt through broker discovery.';
const querySummonMessage = readOptionalEnv('REGISTRY_BROKER_E2E_QUERY_SUMMON_MESSAGE');
const querySummonExpectedText = readOptionalEnv('REGISTRY_BROKER_E2E_QUERY_SUMMON_EXPECT');
const querySummonExpectedUaid = readOptionalEnv('REGISTRY_BROKER_E2E_QUERY_SUMMON_EXPECT_UAID');
const defaultDelegationExpectations = {
  code: { action: undefined, opportunityId: undefined },
  business: { action: undefined, opportunityId: undefined },
  design: { action: undefined, opportunityId: undefined },
};
const delegationConsumptionScenarios = [
  {
    name: 'code',
    task:
      readOptionalEnv('REGISTRY_BROKER_E2E_CODE_TASK') ??
      'Fix this TypeScript plugin bug and verify the patch.',
    context:
      readOptionalEnv('REGISTRY_BROKER_E2E_CODE_CONTEXT') ??
      'Need implementation and verification support for a Codex plugin change.',
    expectedAction:
      readOptionalEnv('REGISTRY_BROKER_E2E_CODE_EXPECT_ACTION') ??
      defaultDelegationExpectations.code.action,
    expectedOpportunityId:
      readOptionalEnv('REGISTRY_BROKER_E2E_CODE_EXPECT_OPPORTUNITY_ID') ??
      defaultDelegationExpectations.code.opportunityId,
  },
  {
    name: 'business',
    task:
      readOptionalEnv('REGISTRY_BROKER_E2E_BUSINESS_TASK') ??
      'Write a business plan and GTM strategy for this product.',
    context:
      readOptionalEnv('REGISTRY_BROKER_E2E_BUSINESS_CONTEXT') ??
      'Need a specialist plan that covers market, positioning, and launch sequencing.',
    expectedAction:
      readOptionalEnv('REGISTRY_BROKER_E2E_BUSINESS_EXPECT_ACTION') ??
      defaultDelegationExpectations.business.action,
    expectedOpportunityId:
      readOptionalEnv('REGISTRY_BROKER_E2E_BUSINESS_EXPECT_OPPORTUNITY_ID') ??
      defaultDelegationExpectations.business.opportunityId,
  },
  {
    name: 'design',
    task:
      readOptionalEnv('REGISTRY_BROKER_E2E_DESIGN_TASK') ??
      'Design a landing page and onboarding UX for this feature.',
    context:
      readOptionalEnv('REGISTRY_BROKER_E2E_DESIGN_CONTEXT') ??
      'Need a specialist recommendation for the product surface and user flow.',
    expectedAction:
      readOptionalEnv('REGISTRY_BROKER_E2E_DESIGN_EXPECT_ACTION') ??
      defaultDelegationExpectations.design.action,
    expectedOpportunityId:
      readOptionalEnv('REGISTRY_BROKER_E2E_DESIGN_EXPECT_OPPORTUNITY_ID') ??
      defaultDelegationExpectations.design.opportunityId,
  },
] as const;

async function main(): Promise<void> {
  const transportEnv: Record<string, string> = {
    ...process.env,
    REGISTRY_BROKER_API_URL: brokerBaseUrl,
    REGISTRY_BROKER_E2E_DISCOVERY_LIMIT: String(discoveryLimit),
  } as Record<string, string>;

  if (discoveryQuery) {
    transportEnv.REGISTRY_BROKER_E2E_DISCOVERY_QUERY = discoveryQuery;
  }
  if (discoveryExpectedUaid) {
    transportEnv.REGISTRY_BROKER_E2E_DISCOVERY_EXPECT_UAID = discoveryExpectedUaid;
  }
  if (discoveryTask) {
    transportEnv.REGISTRY_BROKER_E2E_DISCOVERY_TASK = discoveryTask;
  }
  if (brokerTargetUaid) {
    transportEnv.REGISTRY_BROKER_E2E_UAID = brokerTargetUaid;
  }
  if (brokerProbeMessage) {
    transportEnv.REGISTRY_BROKER_E2E_MESSAGE = brokerProbeMessage;
  }
  if (brokerExpectedText) {
    transportEnv.REGISTRY_BROKER_E2E_EXPECT = brokerExpectedText;
  }

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
    const delegationConsumption = await runDelegationConsumptionChecks(client);
    const directVerification = hasDirectBrokerVerificationConfig()
      ? await runDirectBrokerVerification(client)
      : undefined;

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          delegationConsumption,
          directVerification,
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

async function runDirectBrokerVerification(
  client: Client,
): Promise<{
  delegationPlan: {
    task: string;
    recommendationAction?: string;
    matchedUaid: string;
    matchedLabel?: string;
  };
  discovery: {
    query: string;
    matchedUaid: string;
    matchedLabel?: string;
  };
  dryRun: {
    uaid: string;
    nextAction?: string;
  };
  querySummon?: {
    query: string;
    sessionId: string;
  };
  uaid: string;
  sessionId: string;
}> {
  if (!discoveryTask || !discoveryQuery || !discoveryExpectedUaid || !delegationPlanExpectedUaid || !brokerTargetUaid) {
    throw new Error('Direct broker verification is missing required configuration.');
  }

  const delegationPlanResult = await client.callTool({
    name: 'registryBroker.delegate',
    arguments: {
      task: discoveryTask,
      context: delegationPlanContext,
      limit: Math.min(discoveryLimit, 3),
      workspace: delegationPlanWorkspace,
      ...(registries ? { registries } : {}),
    },
  });
  const delegationPlanPayload = extractToolPayload<{
    planner?: {
      recommendation?: {
        action?: string;
        opportunityId?: string;
        candidate?: {
          uaid?: string;
          label?: string;
        };
      };
      opportunities?: Array<{
        candidates?: Array<{
          uaid?: string;
          label?: string;
        }>;
      }>;
    };
  }>(delegationPlanResult, 'registryBroker.delegate');
  const plannedCandidate =
    (delegationPlanPayload.planner?.recommendation?.candidate?.uaid === delegationPlanExpectedUaid
      ? delegationPlanPayload.planner.recommendation.candidate
      : undefined) ??
    delegationPlanPayload.planner?.opportunities
      ?.flatMap((opportunity) => opportunity.candidates ?? [])
      .find((candidate) => candidate.uaid === delegationPlanExpectedUaid);
  if (!plannedCandidate) {
    throw new Error(
      `delegate did not return the expected candidate payload. expected=${delegationPlanExpectedUaid} recommendation=${String(delegationPlanPayload.planner?.recommendation?.candidate?.uaid)} candidates=${JSON.stringify(
        delegationPlanPayload.planner?.opportunities?.flatMap((opportunity) => opportunity.candidates ?? []).map((candidate) => candidate.uaid) ?? [],
      )}`,
    );
  }
  if (delegationPlanPayload.planner?.recommendation?.action !== delegationPlanRecommendationAction) {
    throw new Error(
      `delegate recommendation action mismatch: expected ${delegationPlanRecommendationAction}, received ${String(delegationPlanPayload.planner?.recommendation?.action)}`,
    );
  }
  if (delegationPlanPayload.planner?.recommendation?.candidate?.uaid !== delegationPlanExpectedUaid) {
    throw new Error('delegate did not recommend the expected candidate.');
  }

  const discoveryResult = await client.callTool({
    name: 'registryBroker.findAgents',
    arguments: {
      query: discoveryQuery,
      task: discoveryTask,
      limit: discoveryLimit,
      ...(registries ? { registries } : {}),
    },
  });
  assertContent(
    discoveryResult,
    discoveryExpectedUaid,
    'findAgents did not surface the expected broker candidate',
  );
  const discoveryPayload = extractToolPayload<{
    candidates?: Array<{
      uaid?: string;
      label?: string;
    }>;
  }>(discoveryResult, 'registryBroker.findAgents');
  const discoveredCandidate = discoveryPayload.candidates?.find(
    (candidate) => candidate.uaid === discoveryExpectedUaid,
  );
  if (!discoveredCandidate) {
    throw new Error('findAgents did not return the expected candidate payload.');
  }

  const querySummonSessionId = querySummonQuery
    ? await runQuerySummonCheck(client)
    : undefined;
  const dryRunResult = await client.callTool({
    name: 'registryBroker.summonAgent',
    arguments: {
      task: 'Verify broker delegation to a caller-specified target agent.',
      uaid: brokerTargetUaid,
      dryRun: true,
      limit: 1,
      mode: 'best-match',
      deliverable: 'Preview the exact outbound prompt before sending.',
      mustInclude: ['The target UAID'],
      acceptanceCriteria: ['Does not open a broker session'],
    },
  });
  assertContent(
    dryRunResult,
    'Dry run only. No broker message sent.',
    'summonAgent dry run did not stay non-destructive',
  );
  const dryRunPayload = extractToolPayload<{
    dryRun?: boolean;
    nextAction?: {
      type?: string;
    };
    dispatchPlan?: Array<{
      uaid?: string;
      message?: string;
    }>;
  }>(dryRunResult, 'registryBroker.summonAgent');
  if (dryRunPayload.dryRun !== true) {
    throw new Error('summonAgent dry run did not mark the payload as dryRun=true.');
  }
  if (dryRunPayload.dispatchPlan?.[0]?.uaid !== brokerTargetUaid) {
    throw new Error('summonAgent dry run did not preserve the direct UAID target.');
  }
  if (!dryRunPayload.dispatchPlan?.[0]?.message?.includes('Acceptance criteria:')) {
    throw new Error('summonAgent dry run did not render the structured brief.');
  }

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

  return {
    delegationPlan: {
      task: discoveryTask,
      recommendationAction: delegationPlanPayload.planner?.recommendation?.action,
      matchedUaid: delegationPlanExpectedUaid,
      matchedLabel: plannedCandidate.label,
    },
    discovery: {
      query: discoveryQuery,
      matchedUaid: discoveryExpectedUaid,
      matchedLabel: discoveredCandidate.label,
    },
    querySummon: querySummonSessionId
      ? {
          query: readRequiredString(querySummonQuery, 'query-driven summon query'),
          sessionId: querySummonSessionId,
        }
      : undefined,
    dryRun: {
      uaid: brokerTargetUaid,
      nextAction: dryRunPayload.nextAction?.type,
    },
    uaid: brokerTargetUaid,
    sessionId,
  };
}

async function runDelegationConsumptionChecks(
  client: Client,
): Promise<
  Array<{
    name: string;
    action: string;
    opportunityId: string;
    candidateLabel?: string;
    dryRunNextAction?: string;
  }>
> {
  const results: Array<{
    name: string;
    action: string;
    opportunityId: string;
    candidateLabel?: string;
    dryRunNextAction?: string;
  }> = [];

  for (const scenario of delegationConsumptionScenarios) {
    const planPayload = await callDelegationPlan(client, scenario.task, scenario.context);
    const action = readRequiredString(
      planPayload.planner?.recommendation?.action,
      `${scenario.name} delegate recommendation action`,
    );
    const opportunityId = readRequiredString(
      planPayload.planner?.recommendation?.opportunityId,
      `${scenario.name} delegate opportunityId`,
    );

    if (scenario.expectedAction && action !== scenario.expectedAction) {
      throw new Error(
        `${scenario.name} delegate action mismatch: expected ${scenario.expectedAction}, received ${action}`,
      );
    }
    if (scenario.expectedOpportunityId && opportunityId !== scenario.expectedOpportunityId) {
      throw new Error(
        `${scenario.name} delegate opportunity mismatch: expected ${scenario.expectedOpportunityId}, received ${opportunityId}`,
      );
    }

    const findAgentsResult = await client.callTool({
      name: 'registryBroker.findAgents',
      arguments: {
        task: scenario.task,
        query: scenario.context,
        context: scenario.context,
        limit: 3,
        deliverable: 'Return the next specialist action plus a concrete output shape.',
        mustInclude: ['selected opportunity', 'recommended action'],
        acceptanceCriteria: ['keeps the next tool choice obvious'],
        workspace: delegationPlanWorkspace,
        ...(registries ? { registries } : {}),
      },
    });
    assertContent(
      findAgentsResult,
      'Recommendation:',
      `${scenario.name} findAgents did not surface a broker recommendation`,
    );
    const findAgentsPayload = extractToolPayload<{
      nextAction?: {
        type?: string;
      };
      selectedOpportunity?: { id?: string };
      planner?: {
        recommendation?: {
          opportunityId?: string;
        };
      };
    }>(findAgentsResult, 'registryBroker.findAgents');
    const selectedOpportunityId =
      readOptionalString(findAgentsPayload.selectedOpportunity?.id) ??
      readOptionalString(findAgentsPayload.planner?.recommendation?.opportunityId);
    if (!selectedOpportunityId) {
      throw new Error(`${scenario.name} findAgents did not return a selected opportunity.`);
    }
    const findAgentsNextAction = readOptionalString(findAgentsPayload.nextAction?.type);

    let dryRunNextAction: string | undefined;

    if (findAgentsNextAction === 'summon-agent') {
      const dryRunResult = await client.callTool({
        name: 'registryBroker.summonAgent',
        arguments: {
          task: scenario.task,
          query: scenario.context,
          context: scenario.context,
          limit: 1,
          mode: 'best-match',
          dryRun: true,
          deliverable: 'Return the next specialist action plus a concrete output shape.',
          mustInclude: ['selected opportunity', 'recommended action'],
          acceptanceCriteria: ['keeps the next tool choice obvious'],
          workspace: delegationPlanWorkspace,
          ...(registries ? { registries } : {}),
        },
      });
      assertContent(
        dryRunResult,
        'Dry run only. No broker message sent.',
        `${scenario.name} summonAgent dry run did not stay non-destructive`,
      );
      const dryRunPayload = extractToolPayload<{
        dryRun?: boolean;
        dispatchPlan?: Array<{
          uaid?: string;
          message?: string;
        }>;
        nextAction?: {
          type?: string;
        };
        selectedOpportunity?: { id?: string };
        planner?: {
          recommendation?: {
            opportunityId?: string;
          };
        };
      }>(dryRunResult, 'registryBroker.summonAgent');
      const dryRunOpportunityId =
        readOptionalString(dryRunPayload.selectedOpportunity?.id) ??
        readOptionalString(dryRunPayload.planner?.recommendation?.opportunityId);

      if (dryRunPayload.dryRun !== true) {
        throw new Error(`${scenario.name} summonAgent dry run payload was not marked dryRun=true.`);
      }
      if (!dryRunOpportunityId) {
        throw new Error(`${scenario.name} summonAgent dry run did not return a selected opportunity.`);
      }
      if ((dryRunPayload.dispatchPlan?.length ?? 0) === 0) {
        throw new Error(`${scenario.name} summonAgent dry run did not produce a dispatch plan.`);
      }
      if (!dryRunPayload.dispatchPlan?.[0]?.message?.includes('Acceptance criteria:')) {
        throw new Error(
          `${scenario.name} summonAgent dry run did not include the structured delegation brief.`,
        );
      }

      dryRunNextAction = readOptionalString(dryRunPayload.nextAction?.type);
    }

    if (findAgentsNextAction !== 'summon-agent') {
      const summonResult = await client.callTool({
        name: 'registryBroker.summonAgent',
        arguments: {
          task: scenario.task,
          query: scenario.context,
          context: scenario.context,
          limit: 1,
          mode: 'best-match',
          deliverable: 'Return the next specialist action plus a concrete output shape.',
          mustInclude: ['selected opportunity', 'recommended action'],
          acceptanceCriteria: ['keeps the next tool choice obvious'],
          workspace: delegationPlanWorkspace,
          ...(registries ? { registries } : {}),
        },
      });
      assertContent(
        summonResult,
        'Recommendation:',
        `${scenario.name} summonAgent did not preserve a broker recommendation`,
      );
      const summonPayload = extractToolPayload<{
        enlisted?: unknown[];
        selectedOpportunity?: { id?: string };
        planner?: {
          recommendation?: {
            opportunityId?: string;
          };
        };
      }>(summonResult, 'registryBroker.summonAgent');
      const summonOpportunityId =
        readOptionalString(summonPayload.selectedOpportunity?.id) ??
        readOptionalString(summonPayload.planner?.recommendation?.opportunityId);
      if (!summonOpportunityId) {
        throw new Error(`${scenario.name} summonAgent did not return a selected opportunity.`);
      }
      if ((summonPayload.enlisted?.length ?? 0) !== 0) {
        throw new Error(`${scenario.name} summonAgent should not send when recommendation=${action}.`);
      }
    }

    results.push({
      name: scenario.name,
      action,
      opportunityId,
      candidateLabel: readOptionalString(planPayload.planner?.recommendation?.candidate?.label),
      dryRunNextAction,
    });
  }

  return results;
}

async function callDelegationPlan(
  client: Client,
  task: string,
  context: string,
): Promise<{
  planner?: {
    recommendation?: {
      action?: string;
      opportunityId?: string;
      candidate?: {
        label?: string;
      };
    };
    opportunities?: Array<{
      id?: string;
      title?: string;
    }>;
  };
}> {
  const result = await client.callTool({
    name: 'registryBroker.delegate',
    arguments: {
      task,
      context,
      limit: 3,
      deliverable: 'Return the next specialist action plus a concrete output shape.',
      mustInclude: ['selected opportunity', 'recommended action'],
      acceptanceCriteria: ['keeps the next tool choice obvious'],
      workspace: delegationPlanWorkspace,
      ...(registries ? { registries } : {}),
    },
  });

  return extractToolPayload(result, 'registryBroker.delegate');
}

function assertContent(
  result: Awaited<ReturnType<Client['callTool']>>,
  needle: string,
  failureMessage: string,
): void {
  const text = getTextContent(result);

  if (!text.includes(needle)) {
    throw new Error(failureMessage);
  }
}

function extractToolPayload<T>(
  result: Awaited<ReturnType<Client['callTool']>>,
  label: string,
): T {
  const text = getTextContent(result);
  const marker = `${label}:\n`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Missing payload marker for ${label}.`);
  }
  const payloadText = text.slice(markerIndex + marker.length);
  return JSON.parse(payloadText) as T;
}

function getTextContent(result: Awaited<ReturnType<Client['callTool']>>): string {
  return Array.isArray(result.content)
    ? result.content
        .map((entry) => ('text' in entry && typeof entry.text === 'string' ? entry.text : ''))
        .join('\n')
    : '';
}

async function runQuerySummonCheck(client: Client): Promise<string> {
  const summonResult = await client.callTool({
    name: 'registryBroker.summonAgent',
    arguments: {
      task: querySummonTask,
      query: querySummonQuery,
      limit: 1,
      mode: 'best-match',
      message: querySummonMessage,
      ...(registries ? { registries } : {}),
    },
  });

  if (querySummonExpectedText) {
    assertContent(
      summonResult,
      querySummonExpectedText,
      'query-driven summonAgent did not return the expected delegated response',
    );
  }

  const summonPayload = extractToolPayload<{
    enlisted?: Array<{
      uaid?: string;
      status?: string;
      response?: {
        sessionId?: string;
      };
    }>;
  }>(summonResult, 'registryBroker.summonAgent');
  const enlisted = summonPayload.enlisted?.[0];

  if (!enlisted || enlisted.status !== 'ok') {
    throw new Error('query-driven summonAgent did not succeed.');
  }
  if (querySummonExpectedUaid && enlisted.uaid !== querySummonExpectedUaid) {
    throw new Error('query-driven summonAgent did not target the expected candidate.');
  }
  if (!enlisted.response?.sessionId) {
    throw new Error('query-driven summonAgent did not return a broker sessionId.');
  }

  return enlisted.response.sessionId;
}

function hasDirectBrokerVerificationConfig(): boolean {
  return Boolean(
    discoveryTask &&
      discoveryQuery &&
      discoveryExpectedUaid &&
      delegationPlanExpectedUaid &&
      brokerTargetUaid,
  );
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRequiredString(value: unknown, label: string): string {
  const stringValue = readOptionalString(value);
  if (!stringValue) {
    throw new Error(`Missing ${label}.`);
  }

  return stringValue;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvOrDefault(name: string, fallback: string): string {
  return readOptionalEnv(name) ?? fallback;
}

function readOptionalIntEnv(name: string): number | undefined {
  const value = readOptionalEnv(name);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer for ${name}.`);
  }

  return parsed;
}

function readOptionalListEnv(name: string): string[] | undefined {
  const value = readOptionalEnv(name);
  if (!value) {
    return undefined;
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.length > 0 ? entries : undefined;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
