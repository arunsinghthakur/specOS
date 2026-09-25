import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/integrations/anthropic/credentials.js", () => ({
  loadAnthropicApiKey: vi.fn(),
}));

const { loadAnthropicApiKey } = await import("../src/integrations/anthropic/credentials.js");
const { applyStoredAnthropicKey } = await import("../src/integrations/anthropic/apply.js");

describe("applyStoredAnthropicKey", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.mocked(loadAnthropicApiKey).mockReset();
  });

  it("sets ANTHROPIC_API_KEY from the keychain when the env var isn't already set", async () => {
    vi.mocked(loadAnthropicApiKey).mockResolvedValue("sk-ant-stored");

    await applyStoredAnthropicKey();

    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-stored");
  });

  it("never overrides an ANTHROPIC_API_KEY the environment already has", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-explicit";
    vi.mocked(loadAnthropicApiKey).mockResolvedValue("sk-ant-stored");

    await applyStoredAnthropicKey();

    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-explicit");
    expect(loadAnthropicApiKey).not.toHaveBeenCalled();
  });

  it("leaves the environment untouched when nothing is stored either", async () => {
    vi.mocked(loadAnthropicApiKey).mockResolvedValue(null);

    await applyStoredAnthropicKey();

    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
