import type { AgentProvider } from "../engine/core/types.js";
import type { Config } from "../config/schema.js";
import type { ApprovalGateHandler } from "../harness/approvalGate.js";
import { StateStore } from "../storage/stateStore.js";
import { AuditLog } from "../harness/auditLog.js";
import { CircuitBreaker, EscalationError, retryWithBackoff, withTimeout } from "../harness/guardrails.js";
import { assertTransition } from "../harness/stateMachine.js";
import { readSpecNodes } from "../spec/specFiles.js";
import { TaskGraph } from "../spec/taskGraph.js";
import type { SpecNode } from "../spec/schema.js";
import { loadProjectMemory } from "../memory/projectMemory.js";
import { SwarmMemory } from "../memory/swarmMemory.js";
import { FeedbackMemory } from "../memory/feedbackMemory.js";
import { buildWorkerSystemPrompt } from "../memory/taskMemory.js";
import { compactWorkerResult } from "../memory/compaction.js";
import { archiveTranscript } from "../memory/transcriptArchive.js";
import {
  abortMerge,
  commitMerge,
  createWorktree,
  commitAll,
  dryRunMerge,
  mergeBranch,
  removeWorktree,
} from "../integrations/git/worktree.js";
import { runWorker } from "../swarm/worker.js";
import { runReviewer } from "../swarm/reviewer.js";
import { resolveConflict } from "../swarm/conflictResolver.js";
import { Mutex } from "../swarm/mutex.js";

const WORKER_TIMEOUT_MS = 10 * 60 * 1000;
const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;
const RETRY_OPTIONS = { maxAttempts: 2, baseDelayMs: 2000 };

export interface OrchestratorDeps {
  provider: AgentProvider;
  config: Config;
  stateStore: StateStore;
  repoRoot: string;
  approvalGate: ApprovalGateHandler;
  testCommand?: string;
}

type TaskOutcome = "merged" | "blocked" | "failed";

/** `budget.maxUsd` isn't enforced yet — we don't have a live per-model pricing table to convert it against. */
function isBudgetExceeded(deps: OrchestratorDeps): boolean {
  const maxTokens = deps.config.budget.maxTokens;
  if (!maxTokens) return false;
  const usage = deps.stateStore.totalUsage();
  return usage.inputTokens + usage.outputTokens >= maxTokens;
}

/**
 * Runs up to `config.concurrency` worker agents in parallel, each in its own git worktree.
 * Merges are still serialized through a mutex, since dry-run/real merges all operate on the
 * single shared integration-branch checkout at repoRoot.
 */
export async function runOrchestrator(deps: OrchestratorDeps): Promise<void> {
  const nodes = await readSpecNodes(deps.repoRoot);
  if (nodes.length === 0) {
    throw new Error("No tasks in specs/ — run `specos spec add <file>` first.");
  }
  const graph = new TaskGraph(nodes);
  const projectMemory = await loadProjectMemory(deps.repoRoot);
  const swarmMemory = new SwarmMemory(deps.repoRoot);
  const feedbackMemory = new FeedbackMemory(deps.repoRoot);
  const audit = new AuditLog(deps.repoRoot);
  const breaker = new CircuitBreaker(0.5, 3);
  const mergeMutex = new Mutex();

  const completed = new Set(
    deps.stateStore
      .listTasks()
      .filter((t) => t.status === "merged")
      .map((t) => t.id),
  );
  const settled = new Set(
    deps.stateStore
      .listTasks()
      .filter((t) => t.status === "failed" || t.status === "blocked")
      .map((t) => t.id),
  );

  const inFlight = new Map<string, Promise<{ id: string; outcome: TaskOutcome }>>();

  for (;;) {
    if (inFlight.size === 0 && isBudgetExceeded(deps)) {
      console.log("Token budget exceeded — stopping run before starting further tasks.");
      break;
    }

    const ready = isBudgetExceeded(deps)
      ? []
      : graph.getReady(completed).filter((node) => !inFlight.has(node.id) && !settled.has(node.id));
    for (const node of ready) {
      if (inFlight.size >= deps.config.concurrency) break;
      inFlight.set(
        node.id,
        processTask(node, deps, projectMemory, swarmMemory, feedbackMemory, audit, mergeMutex).then((outcome) => ({
          id: node.id,
          outcome,
        })),
      );
    }

    if (inFlight.size === 0) break;

    const { id, outcome } = await Promise.race(inFlight.values());
    inFlight.delete(id);
    breaker.record(outcome === "merged");

    if (outcome === "merged") {
      completed.add(id);
    } else {
      settled.add(id);
      console.log(`Task ${id} ended in state "${outcome}".`);
    }

    if (breaker.isTripped()) {
      await Promise.allSettled(inFlight.values());
      throw new Error("Circuit breaker tripped: too many task failures in this run.");
    }
  }
}

async function processTask(
  node: SpecNode,
  deps: OrchestratorDeps,
  projectMemory: string,
  swarmMemory: SwarmMemory,
  feedbackMemory: FeedbackMemory,
  audit: AuditLog,
  mergeMutex: Mutex,
): Promise<TaskOutcome> {
  const { stateStore, repoRoot, config } = deps;
  stateStore.upsertTask(node.id, "pending");
  assertTransition("pending", "assigned");
  stateStore.upsertTask(node.id, "assigned");
  await audit.record(node.id, "assigned");

  try {
    const worktree = await createWorktree(repoRoot, node.id, config.integrationBranch);
    stateStore.upsertTask(node.id, "assigned", worktree.path, worktree.branch);

    assertTransition("assigned", "in_progress");
    stateStore.upsertTask(node.id, "in_progress");
    await audit.record(node.id, "in_progress");

    const completedSummaries = await swarmMemory.all();
    const priorFeedback = await feedbackMemory.forTask(node.id);
    const systemPrompt = buildWorkerSystemPrompt(node, projectMemory, completedSummaries, priorFeedback);

    const workerResult = await retryWithBackoff(
      () => withTimeout(runWorker(deps.provider, node, worktree.path, systemPrompt), WORKER_TIMEOUT_MS, `worker:${node.id}`),
      RETRY_OPTIONS,
      `worker:${node.id}`,
    );
    stateStore.recordUsage(node.id, workerResult.usage);
    await commitAll(worktree.path, `specos: ${node.title}`);
    await archiveTranscript(repoRoot, node.id, workerResult.transcript);
    const summary = await compactWorkerResult(deps.provider, node, workerResult);

    assertTransition("in_progress", "review");
    stateStore.upsertTask(node.id, "review");
    await audit.record(node.id, "review", { summary });

    const review = await withTimeout(
      runReviewer(deps.provider, node, worktree.path, deps.testCommand),
      REVIEW_TIMEOUT_MS,
      `reviewer:${node.id}`,
    );
    await audit.record(node.id, "reviewed", { approved: review.approved, feedback: review.feedback });

    if (!review.approved) {
      assertTransition("review", "blocked");
      stateStore.upsertTask(node.id, "blocked");
      await feedbackMemory.append({ taskId: node.id, feedback: review.feedback, timestamp: new Date().toISOString() });
      console.warn(`Reviewer rejected ${node.id}: ${review.feedback}`);
      return "blocked";
    }

    const mergeSummary = await mergeMutex.runExclusive(() => mergeIntoIntegration(node, worktree, deps, review.feedback));
    if (!mergeSummary.merged) {
      assertTransition("review", "blocked");
      stateStore.upsertTask(node.id, "blocked");
      if (mergeSummary.reason) {
        await feedbackMemory.append({ taskId: node.id, feedback: mergeSummary.reason, timestamp: new Date().toISOString() });
      }
      console.warn(`Merge blocked for ${node.id}: ${mergeSummary.reason}`);
      return "blocked";
    }

    assertTransition("review", "merged");
    stateStore.upsertTask(node.id, "merged");
    await audit.record(node.id, "merged", { conflictResolved: mergeSummary.conflictResolved });
    await swarmMemory.append({
      taskId: node.id,
      summary,
      timestamp: new Date().toISOString(),
    });
    await removeWorktree(repoRoot, worktree).catch(() => undefined);
    return "merged";
  } catch (err) {
    stateStore.upsertTask(node.id, "failed");
    await audit.record(node.id, "failed", { error: err instanceof EscalationError ? err.message : String(err) });
    return "failed";
  }
}

interface MergeAttemptOutcome {
  merged: boolean;
  reason?: string;
  conflictResolved: boolean;
}

/** Runs entirely under the merge mutex: dry-run check, then either a clean merge or conflict resolution, each gated by approval. */
async function mergeIntoIntegration(
  node: SpecNode,
  worktree: { path: string; branch: string },
  deps: OrchestratorDeps,
  reviewFeedback: string,
): Promise<MergeAttemptOutcome> {
  const { repoRoot, config, approvalGate, provider } = deps;
  const clean = await dryRunMerge(repoRoot, worktree.branch, config.integrationBranch);

  if (clean) {
    const approved = await approvalGate.request({
      gate: "merge",
      summary: `Merge ${worktree.branch} into ${config.integrationBranch} for task "${node.title}"?\nReviewer feedback: ${reviewFeedback}`,
    });
    if (!approved) return { merged: false, reason: "merge not approved", conflictResolved: false };

    await mergeBranch(repoRoot, worktree.branch, config.integrationBranch);
    return { merged: true, conflictResolved: false };
  }

  const resolution = await resolveConflict(provider, node, repoRoot, worktree.branch, config.integrationBranch);
  if (!resolution.resolved) {
    return { merged: false, reason: `conflict could not be auto-resolved: ${resolution.summary}`, conflictResolved: false };
  }

  const approved = await approvalGate.request({
    gate: "merge",
    summary: `Merge conflict for task "${node.title}" was auto-resolved: ${resolution.summary}\nCommit this merge into ${config.integrationBranch}?`,
  });
  if (!approved) {
    await abortMerge(repoRoot);
    return { merged: false, reason: "conflict resolution not approved", conflictResolved: false };
  }

  await commitMerge(repoRoot, `Merge ${worktree.branch} into ${config.integrationBranch} (conflict-resolved)`);
  return { merged: true, conflictResolved: true };
}
