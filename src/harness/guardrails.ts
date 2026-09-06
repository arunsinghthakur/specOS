export class TimeoutError extends Error {}
export class EscalationError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

/** Retries `fn` with exponential backoff; after `maxAttempts` failures, throws EscalationError for the harness to route to a human. */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < options.maxAttempts) {
        const delay = options.baseDelayMs * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw new EscalationError(`${label} failed after ${options.maxAttempts} attempts`, lastError);
}

/** Failure-rate circuit breaker across tasks in a single run — trips the whole run rather than retrying forever. */
export class CircuitBreaker {
  private failures = 0;
  private total = 0;

  constructor(private readonly failureRateThreshold: number, private readonly minSamples: number) {}

  record(success: boolean): void {
    this.total += 1;
    if (!success) this.failures += 1;
  }

  isTripped(): boolean {
    return this.total >= this.minSamples && this.failures / this.total >= this.failureRateThreshold;
  }
}
