import { createInterface } from "node:readline/promises";
import type { ApprovalGate, Config } from "../config/schema.js";

export interface ApprovalRequest {
  gate: ApprovalGate;
  summary: string;
}

export interface ApprovalGateHandler {
  request(req: ApprovalRequest): Promise<boolean>;
}

/**
 * Prompts on the CLI for gates enabled in config. `--yes` auto-approves any enabled gate
 * that isn't also listed in `forceManualGates`, so a config author can force certain gates
 * (e.g. final_integration) to always require a human regardless of the flag.
 */
export class CliApprovalGateHandler implements ApprovalGateHandler {
  constructor(private readonly config: Config, private readonly autoYes: boolean) {}

  async request(req: ApprovalRequest): Promise<boolean> {
    if (!this.config.approvalGates.includes(req.gate)) return true;
    if (this.autoYes && !this.config.forceManualGates.includes(req.gate)) return true;

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(`\n[approval required: ${req.gate}]\n${req.summary}\nProceed? (y/N) `);
      return answer.trim().toLowerCase() === "y";
    } finally {
      rl.close();
    }
  }
}

/** Auto-approves everything — for tests and non-interactive dry runs. */
export class AutoApproveGateHandler implements ApprovalGateHandler {
  async request(): Promise<boolean> {
    return true;
  }
}
