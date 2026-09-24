import { z } from "zod";

export const SpecSourceSchema = z.object({
  type: z.enum(["markdown", "text", "jira"]),
  ref: z.string(),
});

export const SpecNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  epic: z.string().optional(),
  nonFunctionalReqs: z.array(z.string()).default([]),
  source: SpecSourceSchema,
});

export type SpecNode = z.infer<typeof SpecNodeSchema>;
export type SpecSource = z.infer<typeof SpecSourceSchema>;

/** Shape the normalizer agent must return; id/source are filled in by the caller, not the model. */
export const NormalizedSpecSchema = SpecNodeSchema.omit({ id: true, source: true });
export type NormalizedSpec = z.infer<typeof NormalizedSpecSchema>;

export const ValidationResultSchema = z.object({
  ambiguous: z.boolean(),
  questions: z.array(z.string()).default([]),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
