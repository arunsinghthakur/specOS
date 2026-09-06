import { describe, expect, it } from "vitest";
import { Mutex } from "../src/swarm/mutex.js";

describe("Mutex", () => {
  it("runs exclusive sections one at a time in call order", async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    async function task(id: number, delayMs: number): Promise<void> {
      await mutex.runExclusive(async () => {
        order.push(id);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        order.push(-id);
      });
    }

    await Promise.all([task(1, 20), task(2, 5), task(3, 1)]);

    // Each task's start (+id) and end (-id) must be adjacent — no interleaving across tasks.
    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });

  it("propagates errors without deadlocking subsequent callers", async () => {
    const mutex = new Mutex();
    await expect(
      mutex.runExclusive(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(mutex.runExclusive(async () => "ok")).resolves.toBe("ok");
  });
});
