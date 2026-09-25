export interface SetupWizardDeps {
  ask: (question: string) => Promise<string>;
  saveAnthropicKey: (key: string) => Promise<void>;
  saveJiraCredentials: (email: string, token: string) => Promise<void>;
  log: (message: string) => void;
}

/**
 * Interactively asks for the credentials specOS can use — an Anthropic API key and Jira Cloud
 * access — saving whatever's provided and skipping (with a pointer to the equivalent `specos
 * auth` command) whatever's left blank. Runs once after install via `specos setup`, but is safe
 * to re-run anytime a credential wasn't handy yet.
 */
export async function runSetupWizard(deps: SetupWizardDeps): Promise<void> {
  deps.log("specOS setup — press Enter to skip any step. Re-run `specos setup` anytime.\n");

  const apiKey = (
    await deps.ask("Anthropic API key (blank to skip — specOS will use your `claude` CLI login instead): ")
  ).trim();
  if (apiKey) {
    await deps.saveAnthropicKey(apiKey);
    deps.log("Saved. specOS will use this key from now on.\n");
  } else {
    deps.log("Skipped. Run `specos auth anthropic --key <key>` later if you need to.\n");
  }

  const host = (await deps.ask("Jira host, e.g. https://your-org.atlassian.net (blank to skip): ")).trim();
  if (!host) {
    deps.log("Skipped. Run `specos auth jira --host <url> --email <email> --token <token>` later if you need to.\n");
    return;
  }

  const email = (await deps.ask("Atlassian account email: ")).trim();
  const token = (await deps.ask("Jira API token: ")).trim();
  if (!email || !token) {
    deps.log("Missing email or token — skipped Jira. Run `specos auth jira ...` later if you need to.\n");
    return;
  }

  await deps.saveJiraCredentials(email, token);
  deps.log(
    `Saved. Run \`specos auth jira --host ${host} --email ${email}\` inside a project to wire this into ` +
      "that project's specos.config.json (no need to re-enter the token).\n",
  );
}
