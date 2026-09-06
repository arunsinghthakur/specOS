import keytar from "keytar";

const SERVICE = "specos-jira";

export interface JiraCredentials {
  email: string;
  apiToken: string;
}

export async function saveJiraCredentials(email: string, apiToken: string): Promise<void> {
  await keytar.setPassword(SERVICE, email, apiToken);
}

export async function loadJiraCredentials(email: string): Promise<JiraCredentials | null> {
  const apiToken = await keytar.getPassword(SERVICE, email);
  if (!apiToken) return null;
  return { email, apiToken };
}

export async function deleteJiraCredentials(email: string): Promise<void> {
  await keytar.deletePassword(SERVICE, email);
}
