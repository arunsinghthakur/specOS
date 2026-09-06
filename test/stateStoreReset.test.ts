import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateStore } from "../src/storage/stateStore.js";

describe("StateStore.resetTask", () => {
  it("forces status back to pending and clears worktree/branch", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specos-state-"));
    try {
      const store = new StateStore(dir);
      store.upsertTask("task-1", "blocked", "/some/worktree", "specos/task-1");
      store.resetTask("task-1");

      const record = store.getTask("task-1");
      expect(record?.status).toBe("pending");
      expect(record?.worktreePath).toBeNull();
      expect(record?.branch).toBeNull();
      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
