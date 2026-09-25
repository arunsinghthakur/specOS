#!/usr/bin/env node
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerRunCommand } from "./commands/run.js";
import { registerSpecCommand } from "./commands/spec.js";
import { registerAuthCommand } from "./commands/auth.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerRetryCommand } from "./commands/retry.js";
import { printBanner, printQuickStart } from "./banner.js";

const program = new Command();

program.name("specos").description("Spec-driven, multi-agent SDLC orchestrator").version("0.1.0");

registerInitCommand(program);
registerSetupCommand(program);
registerAuthCommand(program);
registerSpecCommand(program);
registerPlanCommand(program);
registerRunCommand(program);
registerResumeCommand(program);
registerRetryCommand(program);
registerStatusCommand(program);

// Bare `specos`, with no subcommand — greet a freshly installed user instead of doing nothing.
if (process.argv.length <= 2) {
  printBanner();
  printQuickStart();
  console.log("\nRun `specos --help` for the full command list.");
  process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(`specos: ${(err as Error).message}`);
  process.exitCode = 1;
});
