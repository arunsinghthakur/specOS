import { loadConfig } from "../config/load.js";
import { createProvider } from "../engine/core/registry.js";
import { StateStore } from "../storage/stateStore.js";
import { CliApprovalGateHandler } from "../harness/approvalGate.js";
import { runOrchestrator } from "../orchestrator/orchestrator.js";
import { pushBranch } from "../integrations/git/worktree.js";
import { readSpecNodes } from "../spec/specFiles.js";
import { TaskGraph } from "../spec/taskGraph.js";

export interface RunActionOptions {
  testCommand?: string;
  yes: boolean;
  push?: string;
}

/**
 * Shared by `specos run` and `specos resume`: the orchestrator is already resumable by
 * design — it reads persisted task status from the state store and ingested tasks from
 * specs/ on every invocation, so re-running after an interruption picks up where it left
 * off with no separate code path needed.
 */
export async function executeRun(opts: RunActionOptions): Promise<void> {
  const repoRoot = process.cwd();
  const config = await loadConfig();
  const provider = createProvider(config);
  const stateStore = new StateStore(repoRoot);
  const approvalGate = new CliApprovalGateHandler(config, opts.yes);

  try {
    await runOrchestrator({
      provider,
      config,
      stateStore,
      repoRoot,
      approvalGate,
      testCommand: opts.testCommand,
    });

    if (opts.push) {
      const nodes = await readSpecNodes(repoRoot);
      const graph = new TaskGraph(nodes);
      const merged = stateStore.listTasks().filter((t) => t.status === "merged").length;
      if (merged < graph.size) {
        console.log(`Skipping push — only ${merged}/${graph.size} tasks are merged.`);
        return;
      }
      const approved = await approvalGate.request({
        gate: "final_integration",
        summary: `All ${graph.size} task(s) merged into "${config.integrationBranch}". Push to "${opts.push}"?`,
      });
      if (approved) {
        await pushBranch(repoRoot, opts.push, config.integrationBranch);
        console.log(`Pushed ${config.integrationBranch} to ${opts.push}.`);
      } else {
        console.log("Push skipped.");
      }
    }
  } finally {
    stateStore.close();
  }
}
