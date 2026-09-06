import type { Command } from "commander";
import { executeRun } from "../runAction.js";

export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .description("Resume a run after an interruption or crash — identical to `specos run`, since state is always persisted")
    .option("--test-command <cmd>", 'command the reviewer agent runs to verify each task, e.g. "npm test"')
    .option("--yes", "skip confirmation prompts for gates not forced manual in config", false)
    .option("--push <remote>", "after all tasks merge, gate a push of the integration branch to this remote behind final_integration")
    .action(executeRun);
}
