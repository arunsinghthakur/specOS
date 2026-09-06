import { describe, expect, it } from "vitest";
import { extractJson } from "../src/spec/agents/jsonExtract.js";

describe("extractJson", () => {
  it("parses a well-formed JSON object embedded in surrounding text", () => {
    expect(extractJson('here you go: {"a": 1, "b": "two"} thanks')).toEqual({ a: 1, b: "two" });
  });

  it("drops a bare `undefined` value instead of failing the whole parse", () => {
    expect(extractJson('{"title": "x", "epic": undefined, "priority": "low"}')).toEqual({
      title: "x",
      priority: "low",
    });
  });

  it("throws a clear error when there is no JSON object at all", () => {
    expect(() => extractJson("sorry, I can't help with that")).toThrow(/did not return JSON/);
  });
});
