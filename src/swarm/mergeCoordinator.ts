import { dryRunMerge, mergeBranch, type WorktreeHandle } from "../integrations/git/worktree.js";

export interface MergeOutcome {
  merged: boolean;
  reason?: string;
}

/** Serializes merges into the integration branch, dry-running first to detect conflicts before touching it. */
export async function mergeTask(repoRoot: string, handle: WorktreeHandle, integrationBranch: string): Promise<MergeOutcome> {
  const clean = await dryRunMerge(repoRoot, handle.branch, integrationBranch);
  if (!clean) {
    return { merged: false, reason: `merge conflict detected between ${handle.branch} and ${integrationBranch}` };
  }
  await mergeBranch(repoRoot, handle.branch, integrationBranch);
  return { merged: true };
}
