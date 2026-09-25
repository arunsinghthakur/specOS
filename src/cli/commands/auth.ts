import type { Command } from "commander";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadJiraCredentials, saveJiraCredentials } from "../../integrations/jira/credentials.js";
import { saveAnthropicApiKey } from "../../integrations/anthropic/credentials.js";
import { loadConfig } from "../../config/load.js";
import { ConfigSchema } from "../../config/schema.js";

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Add or update credentials for external integrations");

  auth
    .command("anthropic")
    .description(
      "Store an Anthropic API key in the OS keychain — only needed if the `claude` CLI itself " +
        "isn't already logged in",
    )
    .option("--key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env var instead)")
    .action(async (opts: { key?: string }) => {
      const key = opts.key ?? process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new Error("Provide --key or set the ANTHROPIC_API_KEY environment variable.");
      }
      await saveAnthropicApiKey(key);
      console.log("Stored the Anthropic API key in the OS keychain.");
    });

  auth
    .command("jira")
    .description("Store Jira Cloud credentials (API token goes to the OS keychain, never to a file)")
    .requiredOption("--host <url>", "Jira Cloud host, e.g. https://your-org.atlassian.net")
    .requiredOption("--email <email>", "Atlassian account email")
    .option(
      "--token <token>",
      "Jira API token (or set JIRA_API_TOKEN env var). Omit entirely to keep the token already " +
        "stored for this email and just update the host/email in specos.config.json",
    )
    .action(async (opts: { host: string; email: string; token?: string }) => {
      const token = opts.token ?? process.env.JIRA_API_TOKEN;
      if (token) {
        await saveJiraCredentials(opts.email, token);
      } else if (!(await loadJiraCredentials(opts.email))) {
        throw new Error(
          `No token provided and none already stored for ${opts.email}. Provide --token or set JIRA_API_TOKEN.`,
        );
      }

      const config = await loadConfig();
      const updated = ConfigSchema.parse({ ...config, jira: { host: opts.host, email: opts.email } });
      const configPath = path.join(process.cwd(), "specos.config.json");
      await writeFile(configPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");

      console.log(
        token
          ? `Stored Jira credentials for ${opts.email} in the OS keychain and updated ${configPath}.`
          : `Reused the already-stored Jira token for ${opts.email} and updated ${configPath}.`,
      );
    });
}
