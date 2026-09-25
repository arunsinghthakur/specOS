import keytar from "keytar";

const SERVICE = "specos-anthropic";
const ACCOUNT = "api-key";

export async function saveAnthropicApiKey(apiKey: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, apiKey);
}

export async function loadAnthropicApiKey(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT);
}

export async function deleteAnthropicApiKey(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}
