import type { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { printBanner, printQuickStart } from "../banner.js";
import { runSetupWizard } from "../setupWizard.js";
import { saveAnthropicApiKey } from "../../integrations/anthropic/credentials.js";
import { saveJiraCredentials } from "../../integrations/jira/credentials.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive wizard to store credentials (Anthropic API key, Jira) — safe to skip and re-run anytime")
    .action(async () => {
      printBanner();

      if (!process.stdin.isTTY) {
        console.log(
          "Non-interactive shell — skipping credential setup.\n" +
            "Run `specos setup` from an interactive terminal, or `specos auth anthropic <key>` / " +
            "`specos auth jira ...` directly, whenever you're ready.\n",
        );
        printQuickStart();
        return;
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        await runSetupWizard({
          ask: (question) => rl.question(`  ? ${question}`),
          saveAnthropicKey: saveAnthropicApiKey,
          saveJiraCredentials,
          log: (message) => console.log(message),
        });
      } finally {
        rl.close();
      }

      printQuickStart();
    });
}
