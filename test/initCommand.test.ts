import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();

/**
 * Runs the CLI from source against a *different* cwd (`dir`) than the specOS repo's own. `npx
 * tsx` won't do here — invoked with `cwd: dir` it can't find the locally-installed `tsx` via
 * ancestor node_modules lookup from an unrelated tmp directory and falls back to fetching it from
 * the registry, which fails offline/sandboxed. Invoking specOS's own node_modules/.bin/tsx by
 * absolute path bypasses that resolution entirely.
 */
async function runInit(cwd: string): Promise<void> {
  const tsxBin = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const cli = path.join(REPO_ROOT, "src", "cli", "index.ts");
  await execFileAsync(tsxBin, [cli, "init"], { cwd });
}

describe("specos init (end to end)", () => {
  it("initializes git, and commits specos.config.json + .gitignore so neither is left untracked", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-init-cmd-"));
    try {
      // A fresh git identity is required for the commit step — this dir has no global config to
      // fall back on by default in CI, so set one locally first (harmless if one already exists).
      await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });

      await runInit(dir);

      const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: dir });
      expect(status.stdout.trim()).toBe(""); // nothing untracked or staged — both files committed

      const tracked = await execFileAsync("git", ["ls-tree", "-r", "HEAD", "--name-only"], { cwd: dir });
      expect(tracked.stdout).toContain("specos.config.json");
      expect(tracked.stdout).toContain(".gitignore");

      const gitignore = await readFile(path.join(dir, ".gitignore"), "utf-8");
      expect(gitignore).toContain(".specos/");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
