import { execFile } from "node:child_process";
import { access, rm } from "node:fs/promises";
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

function branchNameFor(taskId: string): string {
  return `specos/${taskId}`;
}

function worktreePathFor(taskId: string, worktreeDir: string): string {
  return `${worktreeDir}/${taskId}`;
}

/** Creates a new branch off `baseBranch` and checks it out into an isolated worktree. */
export async function createWorktree(
  repoRoot: string,
  taskId: string,
  baseBranch: string,
  worktreeDir = ".specos/worktrees",
): Promise<WorktreeHandle> {
  const branch = branchNameFor(taskId);
  const worktreePath = worktreePathFor(taskId, worktreeDir);
  await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseBranch]);
  return { taskId, branch, path: `${repoRoot}/${worktreePath}` };
}

/**
 * Discards a leftover worktree/branch for `taskId` left behind by an earlier run that was
 * killed or crashed before the task reached review/merged. Safe to call unconditionally before
 * (re)assigning a task: the orchestrator only ever does that for a task whose previous attempt
 * never got that far, so there's never real reviewed/merged work to lose. Returns true if there
 * was anything to discard.
 *
 * Checks the branch and the on-disk directory independently, and clears each one that exists —
 * `git worktree remove --force` has been observed to successfully deregister a worktree (it drops
 * out of `git worktree list`, and its branch is gone) while still leaving a residual directory
 * behind at the target path, which then makes the next `git worktree add` fail with "already
 * exists" even though git itself no longer has any record of it.
 */
export async function discardStaleWorktree(
  repoRoot: string,
  taskId: string,
  worktreeDir = ".specos/worktrees",
): Promise<boolean> {
  const branch = branchNameFor(taskId);
  const path = `${repoRoot}/${worktreePathFor(taskId, worktreeDir)}`;
  const hadBranch = await currentBranchExists(repoRoot, branch);

  if (hadBranch) {
    await removeWorktree(repoRoot, { taskId, branch, path }).catch(() => undefined);
    await deleteBranch(repoRoot, branch).catch(() => undefined);
  }

  const hadResidualDir = await access(path)
    .then(() => true)
    .catch(() => false);
  if (hadResidualDir) {
    await rm(path, { recursive: true, force: true });
  }

  return hadBranch || hadResidualDir;
}

export async function removeWorktree(repoRoot: string, handle: WorktreeHandle): Promise<void> {
  await git(repoRoot, ["worktree", "remove", "--force", handle.path]);
}

/**
 * Commits everything in the worker's worktree except `.specos/` — excluded by pathspec, not just
 * relying on the target repo's own .gitignore, since `.specos/` becoming tracked even once means
 * every worktree checked out afterward carries and re-commits it too (observed live: a target
 * project with no pre-existing .gitignore ended up with .specos/ — transcripts, audit log, even a
 * nested worktree copy — baked into its own history).
 */
export async function commitAll(worktreePath: string, message: string): Promise<boolean> {
  await git(worktreePath, ["add", "-A", "--", ".", ":!.specos"]);
  const status = await git(worktreePath, ["status", "--porcelain", "--", ".", ":!.specos"]);
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
