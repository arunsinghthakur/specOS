import type { Command } from "commander";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ConfigSchema } from "../../config/schema.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scaffold specos.config.json in the current directory")
    .option("--provider <name>", "agent provider to use", "claude")
    .option("--concurrency <n>", "max parallel worker agents", "4")
    .action(async (opts: { provider: string; concurrency: string }) => {
      const config = ConfigSchema.parse({
        provider: opts.provider,
        concurrency: Number(opts.concurrency),
      });
      const configPath = path.join(process.cwd(), "specos.config.json");
      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      console.log(`Wrote ${configPath}`);
      console.log("Next: run `specos spec add <file>` to ingest a spec, then `specos plan`.");
    });
}
