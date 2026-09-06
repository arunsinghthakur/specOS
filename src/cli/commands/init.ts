import type { Command } from "commander";
import { writeFile, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { ConfigSchema } from "../../config/schema.js";

const GITIGNORE_ENTRY = ".specos/";

async function ensureGitignoreEntry(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf-8");
  } catch {
    return; // no .gitignore in this project — don't create one on its behalf
  }
  if (existing.split("\n").some((line) => line.trim() === GITIGNORE_ENTRY)) return;
  await appendFile(gitignorePath, `${existing.endsWith("\n") || existing === "" ? "" : "\n"}${GITIGNORE_ENTRY}\n`, "utf-8");
  console.log(`Added "${GITIGNORE_ENTRY}" to .gitignore`);
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scaffold specos.config.json in the current directory")
    .option("--provider <name>", "agent provider to use", "claude")
    .option("--concurrency <n>", "max parallel worker agents", "4")
    .option("--max-tokens <n>", "stop starting new tasks once cumulative token usage reaches this")
    .action(async (opts: { provider: string; concurrency: string; maxTokens?: string }) => {
      const config = ConfigSchema.parse({
        provider: opts.provider,
        concurrency: Number(opts.concurrency),
        budget: opts.maxTokens ? { maxTokens: Number(opts.maxTokens) } : undefined,
      });
      const configPath = path.join(process.cwd(), "specos.config.json");
      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      console.log(`Wrote ${configPath}`);
      await ensureGitignoreEntry(process.cwd());
      console.log("Next: run `specos spec add <file>` to ingest a spec, then `specos plan`.");
    });
}
