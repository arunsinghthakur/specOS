import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, EscalationError, TimeoutError, retryWithBackoff, withTimeout } from "../src/harness/guardrails.js";

describe("withTimeout", () => {
  it("resolves when the promise settles before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "label")).resolves.toBe("ok");
  });

  it("rejects with TimeoutError when the promise is too slow", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 100));
    await expect(withTimeout(slow, 10, "label")).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("retryWithBackoff", () => {
  it("returns the result once the function succeeds within maxAttempts", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
      return "done";
    });
    const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1 }, "label");
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws EscalationError after exhausting attempts", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });
    await expect(retryWithBackoff(fn, { maxAttempts: 2, baseDelayMs: 1 }, "label")).rejects.toBeInstanceOf(
      EscalationError,
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("CircuitBreaker", () => {
  it("is not tripped below the minimum sample size", () => {
    const breaker = new CircuitBreaker(0.5, 5);
    breaker.record(false);
    breaker.record(false);
    expect(breaker.isTripped()).toBe(false);
  });

  it("trips once the failure rate crosses the threshold with enough samples", () => {
    const breaker = new CircuitBreaker(0.5, 2);
    breaker.record(false);
    breaker.record(false);
    expect(breaker.isTripped()).toBe(true);
  });

  it("does not trip when failures stay below the threshold", () => {
    const breaker = new CircuitBreaker(0.5, 2);
    breaker.record(true);
    breaker.record(true);
    breaker.record(false);
    expect(breaker.isTripped()).toBe(false);
  });
});
