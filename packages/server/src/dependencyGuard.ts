/** Process-local admission control for an optional remote dependency.
 * No waiting queue and no automatic retry: an ambiguous write must be reconciled
 * by its domain's durable delivery/receipt contract, never replayed here. */
export class DependencyGuard {
  private readonly maxConcurrent: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private inFlight = 0;
  private failures = 0;
  private reopenAt = 0;
  private generation = 0;

  constructor(
    options: {
      maxConcurrent?: number;
      failureThreshold?: number;
      cooldownMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.maxConcurrent = options.maxConcurrent ?? 16;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 5000;
    this.now = options.now ?? Date.now;
    if (
      ![this.maxConcurrent, this.failureThreshold, this.cooldownMs].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    )
      throw Error('E_DEPENDENCY_CONFIG');
  }

  snapshot(): { state: 'closed' | 'open' | 'half-open'; inFlight: number } {
    return { state: this.state, inFlight: this.inFlight };
  }

  async run<T>(
    operation: () => Promise<T>,
    unavailable: (value: T) => boolean = () => false,
  ): Promise<T> {
    if (this.state === 'half-open' || (this.state === 'open' && this.now() < this.reopenAt))
      throw Error('E_DEPENDENCY_OPEN');
    if (this.inFlight >= this.maxConcurrent) throw Error('E_DEPENDENCY_BUSY');
    const probe = this.state === 'open';
    if (probe) this.state = 'half-open';
    const generation = this.generation;
    this.inFlight++;
    const complete = (failed: boolean) => {
      // Requests admitted before an open/recovery cannot change the new state.
      if (generation !== this.generation) return;
      if (failed) {
        this.failures++;
        if (probe || this.failures >= this.failureThreshold) {
          this.state = 'open';
          this.reopenAt = this.now() + this.cooldownMs;
          this.generation++;
        }
      } else {
        this.failures = 0;
        this.state = 'closed';
        if (probe) this.generation++;
      }
    };
    try {
      const value = await operation();
      complete(unavailable(value));
      return value;
    } catch (error) {
      complete(true);
      throw error;
    } finally {
      this.inFlight--;
    }
  }
}
