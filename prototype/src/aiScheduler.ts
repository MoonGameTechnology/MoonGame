/** Host policy, outside the deterministic kernel. One planning pass OR one order per
 * slice. Seats have stable phases over the decision period, repeated through the day.
 * Only one seat's plan is retained; missed periods are coalesced, never replayed. */
export class StaggeredAi<Action> {
  private epoch = 0;
  private roster: string[] = [];
  private due: number[] = [];
  private pending: {
    seat: string;
    policy: string;
    expires: number;
    actions: Action[];
    index: number;
  } | null = null;

  constructor(private readonly period: number) {
    if (!Number.isFinite(period) || period <= 0) throw new Error('AI period must be positive');
  }

  reset(now: number): void {
    this.epoch = now;
    this.roster = [];
    this.due = [];
    this.pending = null;
  }

  /** Game milliseconds until an eligible actor needs a slice. Offline hosts can
   * sleep until this deadline instead of polling once for EVERY map seat. Reading
   * the deadline never consumes a turn or changes the stable phases on reconnect. */
  nextDelay(
    now: number,
    seats: readonly string[],
    policyFor: (seat: string) => string | null,
  ): number | null {
    this.sync(now, seats);
    if (this.pending) return 0; // drain or discard the bounded retained plan
    let delay = Infinity;
    for (let i = 0; i < this.roster.length; i++) {
      if (policyFor(this.roster[i]!) !== null)
        delay = Math.min(delay, Math.max(0, this.due[i]! - now));
    }
    return delay === Infinity ? null : delay;
  }

  private sync(now: number, seats: readonly string[]): void {
    if (now < this.epoch) this.reset(now);
    if (seats.length !== this.roster.length || seats.some((seat, i) => seat !== this.roster[i])) {
      // A replacement roster starts a fresh spread; joining/leaving a HUMAN does not
      // change the roster, only policyFor, so it never shifts everybody else's turn.
      if (this.roster.length) this.epoch = now;
      this.roster = [...seats];
      this.due = seats.map((_, i) => this.epoch + ((i + 1) * this.period) / seats.length);
      this.pending = null;
    }
  }

  step(
    now: number,
    seats: readonly string[],
    policyFor: (seat: string) => string | null,
    plan: (seat: string, policy: string) => Action[],
  ): { worked: boolean; action?: Action } {
    this.sync(now, seats);
    if (this.pending) {
      const p = this.pending;
      if (now >= p.expires || policyFor(p.seat) !== p.policy) {
        this.pending = null;
        return { worked: true };
      }
      const action = p.actions[p.index++];
      if (p.index === p.actions.length) this.pending = null;
      return { worked: true, action };
    }
    let next = -1;
    for (let i = 0; i < this.due.length; i++) {
      const due = this.due[i]!;
      if (due > now) continue;
      if (policyFor(this.roster[i]!) === null) {
        // Ineligible seats consume no planning/apply slices. Keep their phase so
        // a human stand-in becoming eligible still uses the original roster clock.
        this.due[i] = due + (Math.floor((now - due) / this.period) + 1) * this.period;
        continue;
      }
      if (next < 0 || due < this.due[next]!) next = i;
    }
    if (next < 0) return { worked: false };
    const due = this.due[next]!;
    this.due[next] = due + (Math.floor((now - due) / this.period) + 1) * this.period;
    const seat = this.roster[next]!;
    const policy = policyFor(seat);
    if (policy !== null) {
      const actions = plan(seat, policy);
      if (actions.length)
        this.pending = { seat, policy, actions, index: 0, expires: now + this.period };
    }
    return { worked: true };
  }
}
