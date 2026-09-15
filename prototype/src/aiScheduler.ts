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

  step(
    now: number,
    seats: readonly string[],
    policyFor: (seat: string) => string | null,
    plan: (seat: string, policy: string) => Action[],
  ): { worked: boolean; action?: Action } {
    if (now < this.epoch) this.reset(now);
    if (seats.length !== this.roster.length || seats.some((seat, i) => seat !== this.roster[i])) {
      // A replacement roster starts a fresh spread; joining/leaving a HUMAN does not
      // change the roster, only policyFor, so it never shifts everybody else's turn.
      if (this.roster.length) this.epoch = now;
      this.roster = [...seats];
      this.due = seats.map((_, i) => this.epoch + ((i + 1) * this.period) / seats.length);
      this.pending = null;
    }
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
      if (this.due[i]! <= now && (next < 0 || this.due[i]! < this.due[next]!)) next = i;
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
