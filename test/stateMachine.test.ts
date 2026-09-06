import { describe, expect, it } from "vitest";
import { assertTransition } from "../src/harness/stateMachine.js";

describe("assertTransition", () => {
  it("allows the happy path pending -> assigned -> in_progress -> review -> merged", () => {
    expect(() => assertTransition("pending", "assigned")).not.toThrow();
    expect(() => assertTransition("assigned", "in_progress")).not.toThrow();
    expect(() => assertTransition("in_progress", "review")).not.toThrow();
    expect(() => assertTransition("review", "merged")).not.toThrow();
  });

  it("allows review -> blocked -> in_progress for a retry loop", () => {
    expect(() => assertTransition("review", "blocked")).not.toThrow();
    expect(() => assertTransition("blocked", "in_progress")).not.toThrow();
  });

  it("rejects skipping straight from pending to merged", () => {
    expect(() => assertTransition("pending", "merged")).toThrow(/Illegal task state transition/);
  });

  it("rejects transitions out of terminal states", () => {
    expect(() => assertTransition("merged", "in_progress")).toThrow();
    expect(() => assertTransition("failed", "pending")).toThrow();
  });
});
