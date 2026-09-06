import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

export type TaskStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "review"
  | "blocked"
  | "merged"
  | "failed";

export interface TaskRecord {
  id: string;
  status: TaskStatus;
  worktreePath: string | null;
  branch: string | null;
  updatedAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  worktree_path TEXT,
  branch TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage (
  task_id TEXT PRIMARY KEY,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0
);
`;

export class StateStore {
  private db: Database.Database;

  constructor(projectRoot: string) {
    const dir = path.join(projectRoot, ".specos");
    mkdirSync(dir, { recursive: true });
    this.db = new Database(path.join(dir, "state.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  upsertTask(id: string, status: TaskStatus, worktreePath: string | null = null, branch: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, status, worktree_path, branch, updated_at)
         VALUES (@id, @status, @worktreePath, @branch, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           status = @status,
           worktree_path = COALESCE(@worktreePath, worktree_path),
           branch = COALESCE(@branch, branch),
           updated_at = @updatedAt`,
      )
      .run({ id, status, worktreePath, branch, updatedAt: new Date().toISOString() });
  }

  getTask(id: string): TaskRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | { id: string; status: TaskStatus; worktree_path: string | null; branch: string | null; updated_at: string }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      status: row.status,
      worktreePath: row.worktree_path,
      branch: row.branch,
      updatedAt: row.updated_at,
    };
  }

  listTasks(): TaskRecord[] {
    const rows = this.db.prepare(`SELECT * FROM tasks`).all() as Array<{
      id: string;
      status: TaskStatus;
      worktree_path: string | null;
      branch: string | null;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      worktreePath: row.worktree_path,
      branch: row.branch,
      updatedAt: row.updated_at,
    }));
  }

  recordUsage(taskId: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): void {
    this.db
      .prepare(
        `INSERT INTO usage (task_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
         VALUES (@taskId, @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens)
         ON CONFLICT(task_id) DO UPDATE SET
           input_tokens = input_tokens + @inputTokens,
           output_tokens = output_tokens + @outputTokens,
           cache_read_tokens = cache_read_tokens + @cacheReadTokens,
           cache_write_tokens = cache_write_tokens + @cacheWriteTokens`,
      )
      .run({ taskId, ...usage });
  }

  totalUsage(): { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } {
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
           COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens
         FROM usage`,
      )
      .get() as { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
    return row;
  }

  close(): void {
    this.db.close();
  }
}
