import type { Command } from "commander";

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Build and inspect the task graph from ingested specs (dry run, writes no code)")
    .action(async () => {
      console.log("`specos plan` is not implemented yet (Phase 2 — SDD layer).");
      console.log("See the build order in the project plan: spec ingestion -> task graph builder.");
    });
}
