import type { Command } from "commander";
import { executeRetry } from "../retryAction.js";

export function registerRetryCommand(program: Command): void {
  program
    .command("retry <taskId>")
    .description("Discard a blocked/failed task's worktree and branch, resetting it to pending for the next `specos run`")
    .option("--yes", "skip the destructive-git confirmation prompt", false)
    .action(executeRetry);
}
