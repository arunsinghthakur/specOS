import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { createProvider } from "../../engine/core/registry.js";
import { StateStore } from "../../storage/stateStore.js";
import { CliApprovalGateHandler } from "../../harness/approvalGate.js";
import { runOrchestrator } from "../../orchestrator/orchestrator.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Execute the orchestrator end-to-end with approval gates")
    .option("--test-command <cmd>", "command the reviewer agent runs to verify each task, e.g. \"npm test\"")
    .option("--yes", "skip confirmation prompts for gates not forced manual in config", false)
    .action(async (opts: { testCommand?: string; yes: boolean }) => {
      const config = await loadConfig();
      const provider = createProvider(config);
      const stateStore = new StateStore(process.cwd());
      const approvalGate = new CliApprovalGateHandler(config, opts.yes);

      try {
        await runOrchestrator({
          provider,
          config,
          stateStore,
          repoRoot: process.cwd(),
          approvalGate,
          testCommand: opts.testCommand,
        });
      } finally {
        stateStore.close();
      }
    });
}
