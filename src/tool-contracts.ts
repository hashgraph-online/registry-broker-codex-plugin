import { z } from 'zod';

export const workspaceContextSchema = z
  .object({
    openFiles: z.array(z.string().min(1)).optional(),
    modifiedFiles: z.array(z.string().min(1)).optional(),
    relatedPaths: z.array(z.string().min(1)).optional(),
    errors: z.array(z.string().min(1)).optional(),
    commands: z.array(z.string().min(1)).optional(),
    languages: z.array(z.string().min(1)).optional(),
  })
  .optional();

const stringListSchema = z.array(z.string().min(1)).optional();

export const delegationBriefFieldsSchema = z.object({
  context: z.string().optional(),
  deliverable: z.string().optional(),
  constraints: stringListSchema,
  mustInclude: stringListSchema,
  acceptanceCriteria: stringListSchema,
});

const filterFields = {
  registries: z.array(z.string().min(1)).optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  protocols: z.array(z.string().min(1)).optional(),
  adapters: z.array(z.string().min(1)).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
  type: z.enum(['ai-agents', 'mcp-servers']).optional(),
} as const;

export const searchSchema = z.object({
  query: z.string().min(1),
  task: z.string().optional(),
  opportunityId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).default(5),
  ...filterFields,
  ...delegationBriefFieldsSchema.shape,
  workspace: workspaceContextSchema,
});

export const delegateSchema = z.object({
  task: z.string().min(1),
  limit: z.number().int().min(1).max(5).default(3),
  ...filterFields,
  ...delegationBriefFieldsSchema.shape,
  workspace: workspaceContextSchema,
});

export const summonSchema = z.object({
  task: z.string().min(1),
  query: z.string().optional(),
  opportunityId: z.string().min(1).optional(),
  uaid: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(3).default(3),
  mode: z.enum(['best-match', 'fallback', 'parallel']).default('fallback'),
  dryRun: z.boolean().default(false),
  message: z.string().min(1).optional(),
  streaming: z.boolean().optional(),
  ...filterFields,
  ...delegationBriefFieldsSchema.shape,
  workspace: workspaceContextSchema,
});

export const sessionHistorySchema = z.object({
  sessionId: z.string().min(1),
});
