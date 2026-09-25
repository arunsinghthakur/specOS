import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureGitignoreEntry, ensureGitRepo } from "../src/cli/commands/init.js";

const execFileAsync = promisify(execFile);

describe("ensureGitRepo", () => {
  it("initializes a git repo with a main branch when the directory isn't one yet", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-init-"));
    try {
      await ensureGitRepo(dir);
      await expect(execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir })).resolves.toBeDefined();
      const branch = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: dir });
      expect(branch.stdout.trim()).toBe("main");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves an existing repo untouched, on whatever branch it's already on", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-init-"));
    try {
      await execFileAsync("git", ["init", "-b", "develop"], { cwd: dir });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });

      await ensureGitRepo(dir);

      const branch = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: dir });
      expect(branch.stdout.trim()).toBe("develop");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureGitignoreEntry", () => {
  it("creates .gitignore with .specos/ when the project has none yet", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-init-"));
    try {
      await ensureGitignoreEntry(dir);
      const content = await readFile(path.join(dir, ".gitignore"), "utf-8");
      expect(content).toBe(".specos/\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("appends .specos/ to an existing .gitignore that doesn't have it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-init-"));
    try {
      await writeFile(path.join(dir, ".gitignore"), "node_modules/\n*.db\n", "utf-8");
      await ensureGitignoreEntry(dir);
      const content = await readFile(path.join(dir, ".gitignore"), "utf-8");
      expect(content).toBe("node_modules/\n*.db\n.specos/\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("doesn't duplicate the entry when .specos/ is already present", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-init-"));
    try {
      await writeFile(path.join(dir, ".gitignore"), "node_modules/\n.specos/\n", "utf-8");
      await ensureGitignoreEntry(dir);
      const content = await readFile(path.join(dir, ".gitignore"), "utf-8");
      expect(content).toBe("node_modules/\n.specos/\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
