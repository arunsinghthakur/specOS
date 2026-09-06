import { loadConfig } from "../config/load.js";
import { StateStore } from "../storage/stateStore.js";
import { CliApprovalGateHandler } from "../harness/approvalGate.js";
import { currentBranchExists, deleteBranch, removeWorktree } from "../integrations/git/worktree.js";

export interface RetryActionOptions {
  yes: boolean;
}

export async function executeRetry(taskId: string, opts: RetryActionOptions): Promise<void> {
  const repoRoot = process.cwd();
  const stateStore = new StateStore(repoRoot);
  try {
    const record = stateStore.getTask(taskId);
    if (!record) {
      throw new Error(`Unknown task "${taskId}" — check \`specos status\`.`);
    }
    if (record.status !== "blocked" && record.status !== "failed") {
      throw new Error(`Task "${taskId}" is "${record.status}", not blocked or failed — nothing to retry.`);
    }

    const config = await loadConfig();
    const approvalGate = new CliApprovalGateHandler(config, opts.yes);

    if (record.branch && (await currentBranchExists(repoRoot, record.branch))) {
      const approved = await approvalGate.request({
        gate: "destructive_git",
        summary: `Discard worktree and branch "${record.branch}" for task "${taskId}" so it can be retried from scratch?`,
      });
      if (!approved) {
        console.log("Cancelled.");
        return;
      }
      if (record.worktreePath) {
        await removeWorktree(repoRoot, { taskId, branch: record.branch, path: record.worktreePath }).catch(() => undefined);
      }
      await deleteBranch(repoRoot, record.branch).catch(() => undefined);
    }

    stateStore.resetTask(taskId);
    console.log(`Task "${taskId}" reset to pending. Run \`specos run\` to retry it.`);
  } finally {
    stateStore.close();
  }
}
