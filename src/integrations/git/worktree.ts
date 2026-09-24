import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
  return stdout.trim();
}

export interface WorktreeHandle {
  taskId: string;
  branch: string;
  path: string;
}

/** Creates a new branch off `baseBranch` and checks it out into an isolated worktree. */
export async function createWorktree(
  repoRoot: string,
  taskId: string,
  baseBranch: string,
  worktreeDir = ".specos/worktrees",
): Promise<WorktreeHandle> {
  const branch = `specos/${taskId}`;
  const worktreePath = `${worktreeDir}/${taskId}`;
  await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseBranch]);
  return { taskId, branch, path: `${repoRoot}/${worktreePath}` };
}

export async function removeWorktree(repoRoot: string, handle: WorktreeHandle): Promise<void> {
  await git(repoRoot, ["worktree", "remove", "--force", handle.path]);
}

export async function commitAll(worktreePath: string, message: string): Promise<boolean> {
  await git(worktreePath, ["add", "-A"]);
  const status = await git(worktreePath, ["status", "--porcelain"]);
  if (!status) return false;
  await git(worktreePath, ["commit", "-m", message]);
  return true;
}

/** Stages and commits only the given paths (never `-A`) — used to commit generated files like specs/ without touching unrelated work-in-progress changes. */
export async function commitPaths(repoRoot: string, paths: string[], message: string): Promise<boolean> {
  if (paths.length === 0) return false;
  await git(repoRoot, ["add", "--", ...paths]);
  const status = await git(repoRoot, ["status", "--porcelain", "--", ...paths]);
  if (!status) return false;
  await git(repoRoot, ["commit", "-m", message]);
  return true;
}

/** Attempts a merge without committing, then aborts — used to detect conflicts before touching the integration branch. */
export async function dryRunMerge(repoRoot: string, branch: string, integrationBranch: string): Promise<boolean> {
  try {
    await attemptRealMerge(repoRoot, branch, integrationBranch);
    await abortMerge(repoRoot);
    return true;
  } catch {
    await abortMerge(repoRoot);
    return false;
  }
}

export async function mergeBranch(repoRoot: string, branch: string, integrationBranch: string): Promise<void> {
  await git(repoRoot, ["checkout", integrationBranch]);
  await git(repoRoot, ["merge", "--no-ff", "-m", `Merge ${branch} into ${integrationBranch}`, branch]);
}

export async function currentBranchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await git(repoRoot, ["rev-parse", "--verify", branch]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Real (non-dry-run) merge attempt against the integration branch checkout at `repoRoot`.
 * Leaves conflict markers in the working tree without committing when there's a conflict —
 * used by the conflict-resolution agent, which then edits the conflicted files directly.
 * Resolves normally when the merge succeeds cleanly.
 */
export async function attemptRealMerge(repoRoot: string, branch: string, integrationBranch: string): Promise<void> {
  await git(repoRoot, ["checkout", integrationBranch]);
  await git(repoRoot, ["merge", "--no-commit", "--no-ff", branch]);
}

export async function abortMerge(repoRoot: string): Promise<void> {
  await git(repoRoot, ["merge", "--abort"]).catch(() => undefined);
}

export async function listUnmergedPaths(repoRoot: string): Promise<string[]> {
  const out = await git(repoRoot, ["diff", "--name-only", "--diff-filter=U"]);
  return out.split("\n").filter((line) => line.length > 0);
}

export async function commitMerge(repoRoot: string, message: string): Promise<void> {
  await git(repoRoot, ["commit", "-m", message]);
}

/** Force-deletes a local branch — destructive, discards any commits on it not reachable from elsewhere. */
export async function deleteBranch(repoRoot: string, branch: string): Promise<void> {
  await git(repoRoot, ["branch", "-D", branch]);
}

export async function pushBranch(repoRoot: string, remote: string, branch: string): Promise<void> {
  await git(repoRoot, ["push", remote, branch]);
}
