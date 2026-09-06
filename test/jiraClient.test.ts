import { describe, expect, it, vi } from "vitest";
import { JiraClient } from "../src/integrations/jira/client.js";

function issue(key: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      description: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Description text." }] }],
      },
      priority: { name: "High" },
      issuelinks: [],
      ...overrides,
    },
  };
}

describe("JiraClient.searchIssues", () => {
  it("maps a single page of issues to RawSpecInput", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ issues: [issue("PROJ-1")], startAt: 0, maxResults: 50, total: 1 }),
    });

    const client = new JiraClient({
      host: "https://example.atlassian.net",
      credentials: { email: "a@b.com", apiToken: "token" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const results = await client.searchIssues("project = PROJ");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("PROJ-1");
    expect(results[0].sourceType).toBe("jira");
    expect(results[0].rawText).toContain("Summary for PROJ-1");
    expect(results[0].rawText).toContain("Description text.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("paginates until all issues are fetched", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issues: [issue("PROJ-1")], startAt: 0, maxResults: 1, total: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issues: [issue("PROJ-2")], startAt: 1, maxResults: 1, total: 2 }),
      });

    const client = new JiraClient({
      host: "https://example.atlassian.net",
      credentials: { email: "a@b.com", apiToken: "token" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const results = await client.searchIssues("project = PROJ");
    expect(results.map((r) => r.id)).toEqual(["PROJ-1", "PROJ-2"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when the Jira API responds with an error status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
    const client = new JiraClient({
      host: "https://example.atlassian.net",
      credentials: { email: "a@b.com", apiToken: "bad" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.searchIssues("project = PROJ")).rejects.toThrow(/401/);
  });
});
