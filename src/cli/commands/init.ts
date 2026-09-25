import type { Command } from "commander";
import { execFile } from "node:child_process";
import { writeFile, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ConfigSchema } from "../../config/schema.js";
import { commitPaths } from "../../integrations/git/worktree.js";

const execFileAsync = promisify(execFile);

const GITIGNORE_ENTRY = ".specos/";

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * specOS's worktrees, branches, and merges all need a git repo to work in — initializing one
 * automatically means `specos init` in a brand-new directory just works, instead of failing with
 * an opaque git error the first time `specos run` tries to create a worktree.
 */
export async function ensureGitRepo(cwd: string): Promise<void> {
  if (await isGitRepo(cwd)) return;
  await execFileAsync("git", ["init", "-b", "main"], { cwd });
  console.log(`Initialized a git repository in ${cwd} (branch: main)`);
}

/**
 * `.specos/` (run state, transcripts, worktrees) must never end up tracked in the target repo —
 * a worker's own `git add -A` inside its worktree would otherwise sweep it into that worker's
 * commit the moment it's untracked-but-present, and once it's tracked once, every later worktree
 * checked out from that history carries and re-commits it too. So this creates .gitignore when
 * the project doesn't have one yet, rather than skipping — unlike a stylistic addition, this one
 * is load-bearing for specOS's own correctness.
 */
export async function ensureGitignoreEntry(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf-8");
  } catch {
    await writeFile(gitignorePath, `${GITIGNORE_ENTRY}\n`, "utf-8");
    console.log(`Created .gitignore with "${GITIGNORE_ENTRY}"`);
    return;
  }
  if (existing.split("\n").some((line) => line.trim() === GITIGNORE_ENTRY)) return;
  await appendFile(gitignorePath, `${existing.endsWith("\n") || existing === "" ? "" : "\n"}${GITIGNORE_ENTRY}\n`, "utf-8");
  console.log(`Added "${GITIGNORE_ENTRY}" to .gitignore`);
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scaffold specos.config.json in the current directory (git init'ing it first if needed)")
    .option("--provider <name>", "agent provider to use", "claude")
    .option("--concurrency <n>", "max parallel worker agents", "4")
    .option("--max-tokens <n>", "stop starting new tasks once cumulative token usage reaches this")
    .action(async (opts: { provider: string; concurrency: string; maxTokens?: string }) => {
      await ensureGitRepo(process.cwd());
      const config = ConfigSchema.parse({
        provider: opts.provider,
        concurrency: Number(opts.concurrency),
        budget: opts.maxTokens ? { maxTokens: Number(opts.maxTokens) } : undefined,
      });
      const configPath = path.join(process.cwd(), "specos.config.json");
      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      console.log(`Wrote ${configPath}`);
      await ensureGitignoreEntry(process.cwd());

      // Commit both immediately — left untracked, either one can collide with a file a worker's
      // branch later adds at the same path (observed live: an untracked .gitignore at the
      // integration branch made `git merge` refuse to even start against a branch that also
      // added one), which surfaces as a confusing "blocked" task with no obvious fix.
      const committed = await commitPaths(process.cwd(), ["specos.config.json", ".gitignore"], "specos: init");
      if (committed) console.log("Committed specos.config.json and .gitignore.");

      console.log("Next: run `specos spec add <file>` to ingest a spec, then `specos plan`.");
    });
}
