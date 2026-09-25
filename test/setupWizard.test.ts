import { describe, expect, it, vi } from "vitest";
import { runSetupWizard } from "../src/cli/setupWizard.js";

function deps(answers: Record<string, string>) {
  const saveAnthropicKey = vi.fn(async () => undefined);
  const saveJiraCredentials = vi.fn(async () => undefined);
  const logs: string[] = [];
  const ask = vi.fn(async (question: string) => {
    const match = Object.keys(answers).find((prefix) => question.startsWith(prefix));
    return match ? answers[match] : "";
  });
  return {
    deps: { ask, saveAnthropicKey, saveJiraCredentials, log: (m: string) => logs.push(m) },
    saveAnthropicKey,
    saveJiraCredentials,
    logs,
  };
}

describe("runSetupWizard", () => {
  it("saves both credentials when the user answers every prompt", async () => {
    const { deps: d, saveAnthropicKey, saveJiraCredentials, logs } = deps({
      "Anthropic API key": "sk-ant-123",
      "Jira host": "https://acme.atlassian.net",
      "Atlassian account email": "dev@acme.com",
      "Jira API token": "tok-456",
    });

    await runSetupWizard(d);

    expect(saveAnthropicKey).toHaveBeenCalledWith("sk-ant-123");
    expect(saveJiraCredentials).toHaveBeenCalledWith("dev@acme.com", "tok-456");
    expect(logs.some((l) => l.includes("Saved."))).toBe(true);
  });

  it("skips both credentials cleanly when every prompt is left blank", async () => {
    const { deps: d, saveAnthropicKey, saveJiraCredentials, logs } = deps({});

    await runSetupWizard(d);

    expect(saveAnthropicKey).not.toHaveBeenCalled();
    expect(saveJiraCredentials).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("specos auth anthropic --key"))).toBe(true);
    expect(logs.some((l) => l.includes("specos auth jira --host"))).toBe(true);
  });

  it("skips Jira without saving anything when the email or token is left blank", async () => {
    const { deps: d, saveJiraCredentials, logs } = deps({
      "Jira host": "https://acme.atlassian.net",
      "Atlassian account email": "dev@acme.com",
      // Jira API token intentionally left blank
    });

    await runSetupWizard(d);

    expect(saveJiraCredentials).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("Missing email or token"))).toBe(true);
  });
});
