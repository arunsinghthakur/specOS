import type { AgentActivityEvent, AgentProvider } from "../engine/core/types.js";
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
  discardStaleWorktree,
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

function tag(taskId: string): string {
  return `[${taskId}]`;
}

const TOOL_SUMMARY_FIELD: Record<string, string> = {
  read_file: "path",
  write_file: "path",
  list_dir: "path",
  run_command: "command",
};

function summarizeToolCall(toolName: string, input: Record<string, unknown>): string {
  const field = TOOL_SUMMARY_FIELD[toolName];
  const detail = field && input[field] !== undefined ? String(input[field]) : JSON.stringify(input);
  return `${toolName} ${detail}`;
}

const MAX_ACTIVITY_TEXT_LENGTH = 160;

/** Prints an agent's live tool calls and narration text as they happen, tagged by task id so concurrent tasks stay distinguishable. */
function activityLogger(taskId: string): (event: AgentActivityEvent) => void {
  return (event) => {
    if (event.type === "tool_call") {
      console.log(`${tag(taskId)} → ${summarizeToolCall(event.tool, event.input)}`);
    } else {
      const text = event.text.trim();
      if (!text) return;
      const truncated = text.length > MAX_ACTIVITY_TEXT_LENGTH ? `${text.slice(0, MAX_ACTIVITY_TEXT_LENGTH)}…` : text;
      console.log(`${tag(taskId)} · ${truncated}`);
    }
  };
}

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
  console.log(`${graph.size} task(s) in the graph — running up to ${deps.config.concurrency} at a time.`);
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
  const startedAt = Date.now();
  const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  const onActivity = activityLogger(node.id);

  stateStore.upsertTask(node.id, "pending");
  assertTransition("pending", "assigned");
  stateStore.upsertTask(node.id, "assigned");
  await audit.record(node.id, "assigned");
  console.log(`${tag(node.id)} assigned — preparing worktree`);

  try {
    if (await discardStaleWorktree(repoRoot, node.id)) {
      console.log(`${tag(node.id)} found a leftover worktree/branch from an earlier interrupted run — discarded it before retrying`);
    }
    const worktree = await createWorktree(repoRoot, node.id, config.integrationBranch);
    stateStore.upsertTask(node.id, "assigned", worktree.path, worktree.branch);

    assertTransition("assigned", "in_progress");
    stateStore.upsertTask(node.id, "in_progress");
    await audit.record(node.id, "in_progress");
    console.log(`${tag(node.id)} worker starting in ${worktree.path}`);

    const completedSummaries = await swarmMemory.all();
    const priorFeedback = await feedbackMemory.forTask(node.id);
    const systemPrompt = buildWorkerSystemPrompt(node, projectMemory, completedSummaries, priorFeedback);

    const workerResult = await retryWithBackoff(
      () =>
        withTimeout(
          runWorker(deps.provider, node, worktree.path, systemPrompt, onActivity),
          WORKER_TIMEOUT_MS,
          `worker:${node.id}`,
        ),
      RETRY_OPTIONS,
      `worker:${node.id}`,
    );
    console.log(`${tag(node.id)} worker finished after ${elapsed()} — committing and sending for review`);
    stateStore.recordUsage(node.id, workerResult.usage);
    await commitAll(worktree.path, `specos: ${node.title}`);
    await archiveTranscript(repoRoot, node.id, workerResult.transcript);
    const summary = await compactWorkerResult(deps.provider, node, workerResult);

    assertTransition("in_progress", "review");
    stateStore.upsertTask(node.id, "review");
    await audit.record(node.id, "review", { summary });

    const review = await withTimeout(
      runReviewer(deps.provider, node, worktree.path, deps.testCommand, onActivity),
      REVIEW_TIMEOUT_MS,
      `reviewer:${node.id}`,
    );
    await audit.record(node.id, "reviewed", { approved: review.approved, feedback: review.feedback });

    if (!review.approved) {
      assertTransition("review", "blocked");
      stateStore.upsertTask(node.id, "blocked");
      await feedbackMemory.append({ taskId: node.id, feedback: review.feedback, timestamp: new Date().toISOString() });
      console.warn(`${tag(node.id)} blocked after ${elapsed()} — reviewer rejected: ${review.feedback}`);
      return "blocked";
    }
    console.log(`${tag(node.id)} reviewer approved — merging`);

    const mergeSummary = await mergeMutex.runExclusive(() =>
      mergeIntoIntegration(node, worktree, deps, review.feedback, onActivity),
    );
    if (!mergeSummary.merged) {
      assertTransition("review", "blocked");
      stateStore.upsertTask(node.id, "blocked");
      if (mergeSummary.reason) {
        await feedbackMemory.append({ taskId: node.id, feedback: mergeSummary.reason, timestamp: new Date().toISOString() });
      }
      console.warn(`${tag(node.id)} blocked after ${elapsed()} — merge blocked: ${mergeSummary.reason}`);
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
    console.log(
      `${tag(node.id)} merged after ${elapsed()}${mergeSummary.conflictResolved ? " (conflict auto-resolved)" : ""}`,
    );
    return "merged";
  } catch (err) {
    const message = err instanceof EscalationError ? err.message : String(err);
    stateStore.upsertTask(node.id, "failed");
    await audit.record(node.id, "failed", { error: message });
    console.error(`${tag(node.id)} failed after ${elapsed()} — ${message}`);
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
  onActivity?: (event: AgentActivityEvent) => void,
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

  const resolution = await resolveConflict(provider, node, repoRoot, worktree.branch, config.integrationBranch, onActivity);
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
