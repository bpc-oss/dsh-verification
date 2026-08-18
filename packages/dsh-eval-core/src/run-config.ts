import { z } from 'zod';

/**
 * First-stage eval run config. Aligned with the verified DSH AgentOptions
 * surface: provider, model and maxTokens are the only model-routing fields.
 */
export const EvalRunConfigSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    mode: z.enum(['mock', 'live']).default('mock'),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    maxTokens: z.number().int().positive().optional(),
    samples: z.number().int().positive().default(1),
    timeoutMs: z.number().int().positive().default(10_000)
  })
  .strict();
export type EvalRunConfig = z.infer<typeof EvalRunConfigSchema>;

export interface EvalRunConfigTuningOverrides {
  provider?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export function deriveEvalRunConfigVariant(input: {
  baseConfig: EvalRunConfig;
  id: string;
  label: string;
  overrides: EvalRunConfigTuningOverrides;
}): EvalRunConfig {
  return EvalRunConfigSchema.parse({
    ...input.baseConfig,
    id: input.id,
    label: input.label,
    ...input.overrides
  });
}
