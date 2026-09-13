/** Cooperative presentation work. Progress counts completed jobs, never elapsed time. */
export interface PreparationJob {
  label: string;
  run(): void | Promise<void>;
}

export class MapPreparation {
  active = false;
  ready = false;
  private generation = 0;

  constructor(
    private readonly nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    private readonly now = () => performance.now(),
  ) {}

  async start(
    jobs: readonly PreparationJob[],
    progress: (done: number, total: number, label: string) => void,
  ): Promise<void> {
    const generation = ++this.generation;
    this.active = true;
    this.ready = false;
    progress(0, jobs.length, jobs[0]?.label ?? '');
    // Let the loading screen paint before doing any expensive work.
    await this.nextFrame();
    let slice = this.now();
    for (let i = 0; i < jobs.length; i++) {
      if (generation !== this.generation) return;
      const job = jobs[i]!;
      await job.run();
      if (generation !== this.generation) return;
      progress(i + 1, jobs.length, jobs[i + 1]?.label ?? job.label);
      if (this.now() - slice >= 4 && i + 1 < jobs.length) {
        await this.nextFrame();
        slice = this.now();
      }
    }
    if (generation === this.generation) this.ready = true;
  }

  /** Also invalidates a pending image decode or frame from an older match. */
  cancel(): void {
    this.generation++;
    this.active = false;
    this.ready = false;
  }
}
