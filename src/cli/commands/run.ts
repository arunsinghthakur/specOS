import type { Command } from "commander";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Execute the orchestrator end-to-end with approval gates")
    .option("--concurrency <n>", "override configured worker concurrency")
    .option("--yes", "skip confirmation prompts (approval gates forced in config still apply)", false)
    .action(async () => {
      console.log("`specos run` is not implemented yet (Phase 3 — single-agent execution, then Phase 4 — swarm).");
      console.log("See the build order in the project plan.");
    });
}
