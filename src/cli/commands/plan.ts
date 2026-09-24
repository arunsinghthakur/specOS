import type { Command } from "commander";
import { readSpecNodes } from "../../spec/specFiles.js";
import { TaskGraph } from "../../spec/taskGraph.js";

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Build and inspect the task graph from specs/ (dry run, writes no code)")
    .action(async () => {
      const nodes = await readSpecNodes();
      if (nodes.length === 0) {
        console.log("specs/ has no tasks yet. Run `specos spec add <file>` first.");
        return;
      }

      const graph = new TaskGraph(nodes);
      const order = graph.topologicalOrder();

      console.log(`${graph.size} task(s), execution order (dependencies first):\n`);
      for (const id of order) {
        const node = graph.getNode(id)!;
        const deps = node.dependencies.length > 0 ? ` (depends on: ${node.dependencies.join(", ")})` : "";
        console.log(`  [${node.priority}] ${id} — ${node.title}${deps}`);
      }
    });
}
