#!/usr/bin/env node
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerRunCommand } from "./commands/run.js";
import { registerSpecCommand } from "./commands/spec.js";
import { registerAuthCommand } from "./commands/auth.js";

const program = new Command();

program.name("specos").description("Spec-driven, multi-agent SDLC orchestrator").version("0.1.0");

registerInitCommand(program);
registerAuthCommand(program);
registerSpecCommand(program);
registerPlanCommand(program);
registerRunCommand(program);
registerStatusCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(`specos: ${(err as Error).message}`);
  process.exitCode = 1;
});
