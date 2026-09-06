/**
 * Serializes access to the shared integration-branch checkout at repoRoot. Workers run
 * concurrently in their own worktrees, but dry-run/real merges all `git checkout` and
 * `git merge` inside the same repoRoot working tree, so only one of those can run at a time.
 */
export class Mutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
