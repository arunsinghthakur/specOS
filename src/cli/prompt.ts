import { createInterface } from "node:readline/promises";

/** Prompts on stdin/stdout for a single line of input — used to interactively answer spec clarifying questions. */
export async function askUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`  ? ${question}\n  > `)).trim();
  } finally {
    rl.close();
  }
}
