import type { AgentProvider } from "../engine/core/types.js";
import type { Config } from "../config/schema.js";
import type { ApprovalGateHandler } from "../harness/approvalGate.js";
import { StateStore } from "../storage/stateStore.js";
import { AuditLog } from "../harness/auditLog.js";
import { CircuitBreaker, EscalationError, retryWithBackoff, withTimeout } from "../harness/guardrails.js";
import { assertTransition } from "../harness/stateMachine.js";
import { readSpecLock } from "../spec/lock.js";
import { TaskGraph } from "../spec/taskGraph.js";
import type { SpecNode } from "../spec/schema.js";
import { loadProjectMemory } from "../memory/projectMemory.js";
import { SwarmMemory } from "../memory/swarmMemory.js";
import { buildWorkerSystemPrompt, extractDoneSummary } from "../memory/taskMemory.js";
import { createWorktree, commitAll, removeWorktree } from "../integrations/git/worktree.js";
import { runWorker } from "../swarm/worker.js";
import { runReviewer } from "../swarm/reviewer.js";
import { mergeTask } from "../swarm/mergeCoordinator.js";

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

/**
 * Single-worker orchestration loop: processes ready tasks one at a time in their own
 * worktree (no concurrency yet — that's Phase 4). Validates the harness state machine,
 * approval gates, and memory tiers end-to-end before adding parallel workers.
 */
export async function runOrchestrator(deps: OrchestratorDeps): Promise<void> {
  const nodes = await readSpecLock(deps.repoRoot);
  if (nodes.length === 0) {
    throw new Error("No tasks in spec.lock.json — run `specos spec add <file>` first.");
  }
  const graph = new TaskGraph(nodes);
  const projectMemory = await loadProjectMemory(deps.repoRoot);
  const swarmMemory = new SwarmMemory(deps.repoRoot);
  const audit = new AuditLog(deps.repoRoot);
  const breaker = new CircuitBreaker(0.5, 3);

  const completed = new Set(
    deps.stateStore
      .listTasks()
      .filter((t) => t.status === "merged")
      .map((t) => t.id),
  );

  for (;;) {
    const ready = graph.getReady(completed).filter((node) => deps.stateStore.getTask(node.id)?.status !== "failed");
    if (ready.length === 0) break;

    const node = ready[0];
    const outcome = await processTask(node, deps, projectMemory, swarmMemory, audit);
    breaker.record(outcome === "merged");

    if (outcome === "merged") {
      completed.add(node.id);
    } else {
      console.log(`Task ${node.id} ended in state "${outcome}" — stopping run for review.`);
      break;
    }

    if (breaker.isTripped()) {
      throw new Error("Circuit breaker tripped: too many task failures in this run.");
    }
  }
}

type TaskOutcome = "merged" | "blocked" | "failed";

async function processTask(
  node: SpecNode,
  deps: OrchestratorDeps,
  projectMemory: string,
  swarmMemory: SwarmMemory,
  audit: AuditLog,
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
    const systemPrompt = buildWorkerSystemPrompt(node, projectMemory, completedSummaries);

    const workerResult = await retryWithBackoff(
      () => withTimeout(runWorker(deps.provider, node, worktree.path, systemPrompt), WORKER_TIMEOUT_MS, `worker:${node.id}`),
      RETRY_OPTIONS,
      `worker:${node.id}`,
    );
    stateStore.recordUsage(node.id, workerResult.usage);
    await commitAll(worktree.path, `specos: ${node.title}`);

    assertTransition("in_progress", "review");
    stateStore.upsertTask(node.id, "review");
    await audit.record(node.id, "review", { summary: extractDoneSummary(workerResult.finalMessage) });

    const review = await withTimeout(
      runReviewer(deps.provider, node, worktree.path, deps.testCommand),
      REVIEW_TIMEOUT_MS,
      `reviewer:${node.id}`,
    );
    await audit.record(node.id, "reviewed", { approved: review.approved, feedback: review.feedback });

    if (!review.approved) {
      assertTransition("review", "blocked");
      stateStore.upsertTask(node.id, "blocked");
      console.warn(`Reviewer rejected ${node.id}: ${review.feedback}`);
      return "blocked";
    }

    const approved = await deps.approvalGate.request({
      gate: "merge",
      summary: `Merge ${worktree.branch} into ${config.integrationBranch} for task "${node.title}"?\nReviewer feedback: ${review.feedback}`,
    });
    if (!approved) {
      assertTransition("review", "blocked");
      stateStore.upsertTask(node.id, "blocked");
      return "blocked";
    }

    const mergeOutcome = await mergeTask(repoRoot, worktree, config.integrationBranch);
    if (!mergeOutcome.merged) {
      assertTransition("review", "blocked");
      stateStore.upsertTask(node.id, "blocked");
      console.warn(`Merge blocked for ${node.id}: ${mergeOutcome.reason}`);
      return "blocked";
    }

    assertTransition("review", "merged");
    stateStore.upsertTask(node.id, "merged");
    await audit.record(node.id, "merged");
    await swarmMemory.append({
      taskId: node.id,
      summary: extractDoneSummary(workerResult.finalMessage),
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
