import { z } from "zod";

export const ApprovalGateSchema = z.enum(["merge", "destructive_git", "final_integration"]);

export const ConfigSchema = z.object({
  provider: z.enum(["claude"]).default("claude"),
  concurrency: z.number().int().min(1).max(16).default(4),
  budget: z
    .object({
      maxTokens: z.number().int().positive().optional(),
      maxUsd: z.number().positive().optional(),
    })
    .default({}),
  approvalGates: z.array(ApprovalGateSchema).default(["merge", "destructive_git", "final_integration"]),
  /** Gates that must always prompt, even when `specos run --yes` is passed. */
  forceManualGates: z.array(ApprovalGateSchema).default([]),
  integrationBranch: z.string().default("main"),
  jira: z
    .object({
      host: z.string().url().optional(),
      email: z.string().email().optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ApprovalGate = z.infer<typeof ApprovalGateSchema>;
