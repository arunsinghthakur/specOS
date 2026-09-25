import type { AgentActivityEvent, AgentProvider } from "../engine/core/types.js";
import type { SpecNode } from "../spec/schema.js";
import { abortMerge, attemptRealMerge, listUnmergedPaths } from "../integrations/git/worktree.js";
import { buildWorkerTools } from "./tools.js";
import { extractDoneSummary } from "../memory/taskMemory.js";

const MAX_TURNS = 40;

export interface ConflictResolutionResult {
  /** True when the working tree has no unmerged paths left — caller still must commit or abort. */
  resolved: boolean;
  summary: string;
}

function systemPrompt(conflictedFiles: string[]): string {
  return [
    "You are resolving a git merge conflict. The current working directory is the integration branch",
    "checkout with conflict markers (<<<<<<<, =======, >>>>>>>) already present in the files below.",
    `Conflicted files: ${conflictedFiles.join(", ")}`,
    "Edit each file to a correct resolution that preserves the intent of both sides, removing all conflict markers.",
    "After fixing each file, run `git add <file>` via run_command to mark it resolved in the index.",
    "Use run_command to run the project's build/test command and confirm the result compiles/passes before finishing.",
    "Reply with a final message starting with 'DONE:' summarizing how you resolved it, or 'UNRESOLVED:' if you cannot",
    "confidently resolve the conflict — do not leave partially-edited files with markers still present in that case.",
    "Do NOT run `git commit` yourself — the caller commits after a separate approval step.",
  ].join("\n");
}

/**
 * Runs a real (non-dry-run) merge attempt in `repoRoot`'s shared checkout, then lets a
 * narrowly-scoped agent edit just the conflicting files. Leaves the merge staged but
 * uncommitted on success so the caller can gate the commit behind human approval; aborts
 * and leaves the working tree clean on failure. Caller must hold the merge mutex — this
 * touches the same shared working tree dryRunMerge/mergeBranch use.
 */
export async function resolveConflict(
  provider: AgentProvider,
  node: SpecNode,
  repoRoot: string,
  branch: string,
  integrationBranch: string,
  onActivity?: (event: AgentActivityEvent) => void,
): Promise<ConflictResolutionResult> {
  let mergeError: string | undefined;
  try {
    await attemptRealMerge(repoRoot, branch, integrationBranch);
  } catch (err) {
    // Expected when it's a real conflict — git exits non-zero and leaves conflict markers.
    // But git also exits non-zero, with *no* conflict markers at all, for problems that have
    // nothing to do with content conflicts (e.g. an untracked file at the integration branch
    // colliding with one the incoming branch adds) — keep the message so that case is reported
    // usefully below instead of as a bare "no conflicting files found".
    const error = err as { stderr?: string; message: string };
    mergeError = (error.stderr || error.message).trim();
  }

  const conflictedFiles = await listUnmergedPaths(repoRoot);
  if (conflictedFiles.length === 0) {
    await abortMerge(repoRoot);
    return {
      resolved: false,
      summary: mergeError
        ? `merge could not even start (not a content conflict — needs a human to fix the integration branch's working tree, not an AI edit): ${mergeError}`
        : "merge attempt produced no changes and no conflicts — nothing to resolve",
    };
  }

  const agent = await provider.createAgent({
    role: "conflict-resolver",
    systemPrompt: systemPrompt(conflictedFiles),
    tools: buildWorkerTools(repoRoot),
    cwd: repoRoot,
    maxTurns: MAX_TURNS,
    onActivity,
  });

  const result = await agent.sendMessage(
    `Resolve the merge conflicts for task "${node.title}".\n${node.description}\nConflicted files: ${conflictedFiles.join(", ")}`,
  );

  const stillConflicted = await listUnmergedPaths(repoRoot);
  const summary = extractDoneSummary(result.finalMessage);
  if (stillConflicted.length > 0 || /^UNRESOLVED:/i.test(result.finalMessage.trim())) {
    await abortMerge(repoRoot);
    return { resolved: false, summary };
  }

  return { resolved: true, summary };
}
