import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// The first `tsx` invocation in this file pays a real cold-start cost (JIT-compiling the whole
// CLI + dependency tree); that's occasionally slower than vitest's default 5000ms test timeout
// under load, which flaked this file twice in one session — worth a real fix, not a re-run habit.
const TIMEOUT_MS = 15_000;

/** Runs the CLI from source (no build step, same as `npm run dev`) with --help appended. */
async function help(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("npx", ["tsx", "src/cli/index.ts", ...args, "--help"]);
  return stdout;
}

/**
 * Asserts `name` (a command or `--flag`) is an actual registered entry in Commander's `--help`
 * output, not just a word that happens to appear in some other line's free-form description
 * (e.g. resume's description mentions "specos run" in prose, and spec add's own description
 * mentions "--text" — a plain `toContain` would pass even if that command/option didn't exist).
 * Commander indents every real Commands:/Options: entry by exactly two spaces from the line
 * start, which prose continuation lines never match.
 */
function expectRegisteredEntry(output: string, name: string): void {
  const pattern = new RegExp(`^  ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[\\s,]|$)`, "m");
  expect(output, `expected "${name}" to be a registered entry, not just mentioned in prose`).toMatch(pattern);
}

describe("CLI --help reflects every registered command and option", () => {
  it("top-level help lists every command", async () => {
    const out = await help();
    for (const cmd of ["init", "setup", "auth", "spec", "plan", "run", "resume", "retry", "status"]) {
      expectRegisteredEntry(out, cmd);
    }
  }, TIMEOUT_MS);

  it("spec add documents all three input sources plus --id and --yes", async () => {
    const out = await help("spec", "add");
    expectRegisteredEntry(out, "--jira");
    expectRegisteredEntry(out, "--text");
    expectRegisteredEntry(out, "--id");
    expectRegisteredEntry(out, "--yes");
  }, TIMEOUT_MS);

  it("auth anthropic documents --key", async () => {
    const out = await help("auth", "anthropic");
    expectRegisteredEntry(out, "--key");
  }, TIMEOUT_MS);

  it("auth jira documents --host, --email, and --token", async () => {
    const out = await help("auth", "jira");
    expectRegisteredEntry(out, "--host");
    expectRegisteredEntry(out, "--email");
    expectRegisteredEntry(out, "--token");
  }, TIMEOUT_MS);

  it("run and resume both document --test-command, --yes, and --push", async () => {
    for (const cmd of ["run", "resume"]) {
      const out = await help(cmd);
      expectRegisteredEntry(out, "--test-command");
      expectRegisteredEntry(out, "--yes");
      expectRegisteredEntry(out, "--push");
    }
  }, TIMEOUT_MS);

  it("retry documents --yes and its required taskId argument", async () => {
    const out = await help("retry");
    expect(out).toContain("<taskId>");
    expectRegisteredEntry(out, "--yes");
  }, TIMEOUT_MS);

  it("status documents --usage", async () => {
    const out = await help("status");
    expectRegisteredEntry(out, "--usage");
  }, TIMEOUT_MS);

  it("init documents --provider, --concurrency, and --max-tokens", async () => {
    const out = await help("init");
    expectRegisteredEntry(out, "--provider");
    expectRegisteredEntry(out, "--concurrency");
    expectRegisteredEntry(out, "--max-tokens");
  }, TIMEOUT_MS);
});
