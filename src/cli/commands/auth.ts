import type { Command } from "commander";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { saveJiraCredentials } from "../../integrations/jira/credentials.js";
import { loadConfig } from "../../config/load.js";
import { ConfigSchema } from "../../config/schema.js";

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Manage credentials for external integrations");

  auth
    .command("jira")
    .description("Store Jira Cloud credentials (API token goes to the OS keychain, never to a file)")
    .requiredOption("--host <url>", "Jira Cloud host, e.g. https://your-org.atlassian.net")
    .requiredOption("--email <email>", "Atlassian account email")
    .option("--token <token>", "Jira API token (or set JIRA_API_TOKEN env var instead)")
    .action(async (opts: { host: string; email: string; token?: string }) => {
      const token = opts.token ?? process.env.JIRA_API_TOKEN;
      if (!token) {
        throw new Error("Provide --token or set the JIRA_API_TOKEN environment variable.");
      }

      await saveJiraCredentials(opts.email, token);

      const config = await loadConfig();
      const updated = ConfigSchema.parse({ ...config, jira: { host: opts.host, email: opts.email } });
      const configPath = path.join(process.cwd(), "specos.config.json");
      await writeFile(configPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");

      console.log(`Stored Jira credentials for ${opts.email} in the OS keychain and updated ${configPath}.`);
    });
}
