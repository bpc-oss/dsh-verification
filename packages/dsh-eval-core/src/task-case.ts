import path from 'node:path';
import { z } from 'zod';

export function normalizeWorkspaceSeedPath(value: string): string {
  const trimmed = value.trim();
  const slashified = trimmed.replace(/\\/g, '/');
  return path.posix.normalize(slashified);
}

const RelativeWorkspacePathSchema = z.string().min(1).superRefine((value, ctx) => {
  const trimmed = value.trim();
  const normalized = normalizeWorkspaceSeedPath(value);

  if (trimmed.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'workspaceSeed.path must be a non-empty relative workspace path' });
    return;
  }

  if (path.isAbsolute(trimmed) || /^[A-Za-z]:[\/]/.test(trimmed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'workspaceSeed.path must be relative to the temporary workspace' });
    return;
  }

  if (normalized === '..' || normalized.startsWith('../')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'workspaceSeed.path must stay within the temporary workspace' });
  }
});

export const EvalWorkspaceSeedEntrySchema = z.object({
  path: RelativeWorkspacePathSchema,
  content: z.string()
});
export type EvalWorkspaceSeedEntry = z.infer<typeof EvalWorkspaceSeedEntrySchema>;

export const EvalMockScenarioSchema = z
  .object({
    runnerResponses: z.array(z.string().min(1)).min(1),
    graderResponses: z.array(z.string().min(1)).default([])
  })
  .strict();
export type EvalMockScenario = z.infer<typeof EvalMockScenarioSchema>;

const FileExistsOracleSchema = z.object({
  kind: z.literal('file_exists'),
  path: RelativeWorkspacePathSchema
});

const FileContainsOracleSchema = z.object({
  kind: z.literal('file_contains'),
  path: RelativeWorkspacePathSchema,
  text: z.string()
});

const FileNotContainsOracleSchema = z.object({
  kind: z.literal('file_not_contains'),
  path: RelativeWorkspacePathSchema,
  text: z.string()
});

const CommandExitCodeOracleSchema = z.object({
  kind: z.literal('command_exit_code'),
  cmd: z.string().min(1),
  args: z.array(z.string()).default([]),
  expectedExitCode: z.number().int()
});

export const EvalOracleSchema = z.discriminatedUnion('kind', [
  FileExistsOracleSchema,
  FileContainsOracleSchema,
  FileNotContainsOracleSchema,
  CommandExitCodeOracleSchema
]);
export type EvalOracle = z.infer<typeof EvalOracleSchema>;

/**
 * Task contract used by eval fixtures. This is intentionally the lightweight
 * Bobby eval shape, not the server-minted verification TaskContract: eval
 * fixtures describe an intended goal/AC set, while the verification plugin owns
 * ref/origin/identity minting.
 */
export const EvalTaskContractSchema = z
  .object({
    goal: z.string().min(1),
    acceptanceCriteria: z
      .array(
        z
          .object({
            id: z.string().min(1),
            desc: z.string().min(1),
            oracleHint: z.enum(['test', 'run', 'file', 'schema', 'review', 'human'])
          })
          .strict()
      )
      .min(1),
    constraints: z
      .array(
        z
          .object({
            id: z.string().min(1),
            desc: z.string().min(1),
            check: z.string().min(1)
          })
          .strict()
      )
      .default([]),
    inputs: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).default([])
  })
  .strict();
export type EvalTaskContract = z.infer<typeof EvalTaskContractSchema>;

/**
 * Eval task case. Deliberately has NO trust field: trustLevel is injected by
 * the loader (see trust.ts), never declared by the fixture itself.
 */
export const EvalTaskCaseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    prompt: z.string().min(1),
    difficulty: z.enum(['simple', 'normal', 'difficult']),
    workspaceSeed: z.array(EvalWorkspaceSeedEntrySchema).default([]),
    contract: EvalTaskContractSchema,
    mockScenario: EvalMockScenarioSchema.optional(),
    oracle: EvalOracleSchema,
    tags: z.array(z.string().min(1)).default([])
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const entry of value.workspaceSeed) {
      const normalized = normalizeWorkspaceSeedPath(entry.path);
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `workspaceSeed contains duplicate path ${entry.path}`,
          path: ['workspaceSeed']
        });
        return;
      }
      seen.add(normalized);
    }
  });
export type EvalTaskCase = z.infer<typeof EvalTaskCaseSchema>;
