import type { TaskStatus } from "../storage/stateStore.js";

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["assigned"],
  assigned: ["in_progress", "failed"],
  in_progress: ["review", "failed"],
  review: ["merged", "blocked", "failed"],
  blocked: ["in_progress", "failed"],
  merged: [],
  failed: [],
};

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Illegal task state transition: ${from} -> ${to}`);
  }
}
