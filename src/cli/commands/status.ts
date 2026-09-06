import type { Command } from "commander";
import { StateStore } from "../../storage/stateStore.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show task graph state and token usage for the current run")
    .option("--usage", "include cumulative token usage", false)
    .action(async (opts: { usage: boolean }) => {
      const store = new StateStore(process.cwd());
      const tasks = store.listTasks();
      if (tasks.length === 0) {
        console.log("No tasks recorded yet. Run `specos plan` then `specos run`.");
      } else {
        for (const task of tasks) {
          console.log(`${task.id}\t${task.status}\t${task.branch ?? "-"}\t${task.updatedAt}`);
        }
      }
      if (opts.usage) {
        const usage = store.totalUsage();
        console.log(
          `\nUsage: input=${usage.inputTokens} output=${usage.outputTokens} cacheRead=${usage.cacheReadTokens} cacheWrite=${usage.cacheWriteTokens}`,
        );
      }
      store.close();
    });
}
