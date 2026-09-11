import { describe, expect, it } from 'vitest';
import { stewardGuardOrders, aiOrders, order, advance, HOUR } from './game';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type UnitStack,
} from '../../packages/shared-core/src/index';

// Hand-built geometry (the threat.test.ts pattern): chain E—H—S, 100 units per
// lane. p1 owns H (home) and S (the safe rear); p2 is the hostile. p1's owned
// worlds identify 1 hop out, so a hostile anchored at E is legitimately visible.
const NOW = 500 * HOUR;
const stacks = (list: Array<[string, number]>): UnitStack[] =>
  list.map(([unit, count]) => ({ unit, count }));
function world(id: string, owner: string | null, x: number, links: string[], garrison: UnitStack[] = []): Planet {
  return { id, owner, kind: 'planet', position: { x, y: 0 }, resources: {}, buildings: [], garrison, traits: [], links };
}
function fl(id: string, owner: string, patch: Partial<Fleet>): Fleet {
  return { id, owner, location: null, movement: null, units: [], traits: [], ...patch };
}
function guardState(opts: {
  fleets: Fleet[];
  hGarrison?: UnitStack[];
  sGarrison?: UnitStack[];
  ownS?: boolean;
  withR?: boolean;
  battles?: GameState['battles'];
}): GameState {
  const s = createInitialState({ seed: 'sg', version: { data: '0.1.0', manifest: '1' } });
  const f: Record<string, Fleet> = {};
  for (const x of opts.fleets) f[x.id] = x;
  const player = (id: string) => ({ id, name: id, faction: 'azure', status: 'active' as const, resources: {} });
  // p1 runs a live delegation: the guard only ever ticks for a delegated seat, and
  // the SITREP stamp (steward.report) applies through the real kernel only then.
  const p1 = { ...player('p1'), steward: { posture: 'defend', until: NOW + 1000 * HOUR } };
  return {
    ...s,
    time: NOW,
    planets: {
      // E belongs to the hostile — else an advance() through the real kernel
      // eliminates a landless p2 (victory: no-territory) and deletes its fleets.
      E: world('E', 'p2', 0, ['H']),
      H: world('H', 'p1', 100, ['E', 'S'], opts.hGarrison ?? []),
      S: world('S', opts.ownS === false ? null : 'p1', 200, opts.withR ? ['H', 'R'] : ['H'], opts.sGarrison ?? []),
      ...(opts.withR ? { R: world('R', 'p1', 300, ['S']) } : {}),
      // Far neutral island: dilutes p1's ownership share so an advance() through
      // the real kernel doesn't end the match by domination mid-test.
      N1: world('N1', null, 1000, ['N2']),
      N2: world('N2', null, 1100, ['N1']),
    },
    fleets: f,
    players: { p1, p2: player('p2') },
    ...(opts.battles ? { battles: opts.battles } : {}),
  };
}
/** The trailing SITREP stamp's entries — every threat tick narrates itself. */
function reportEntries(orders: ReturnType<typeof stewardGuardOrders>): Array<Record<string, unknown>> {
  const last = orders[orders.length - 1];
  expect(last?.type).toBe('steward.report');
  return (last!.payload as { entries: Array<Record<string, unknown>> }).entries;
}
/** A hostile wing big enough that the stand forecast breaches the 35% limit. */
const raider = (patch: Partial<Fleet>): Fleet =>
  fl('E1', 'p2', { units: stacks([['cruiser', 4]]), ...patch });
const inboundToH = (arrivesInHours: number): Partial<Fleet> => ({
  movement: {
    from: 'E',
    to: 'H',
    departedAt: NOW - 1 * HOUR,
    arrivesAt: NOW + arrivesInHours * HOUR,
  },
});

describe('stewardGuardOrders — эвакуация под угрозой (ST-3.2)', () => {
  it('a doomed stand: the docked fleet lifts the garrison into its hold and flies to the safe world', () => {
    const s = guardState({
      fleets: [raider(inboundToH(10)), fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 1]]) })],
      hGarrison: stacks([['militia', 4]]),
    });
    const orders = stewardGuardOrders(s, 'p1');
    // ПОДЪЁМ ЗАНИМАЕТ ЧАС (CARGO-1), и вылет его отменяет — значит в один тик
    // «погрузить и улететь» больше нельзя: этот тик только грузит. SITREP-штамп,
    // объясняющий решение, по-прежнему едет последним.
    expect(orders.map((a) => a.type)).toEqual(['army.load', 'steward.report']);
    expect(orders[0]!.payload).toMatchObject({ fleetId: 'F1', unit: 'militia', count: 4 });
    expect(reportEntries(orders)).toMatchObject([{ kind: 'evac', node: 'H', to: 'S', count: 1 }]);
    // Пока подъём идёт, паром СТОИТ — иначе он ушёл бы пустым, бросив тех, за кем пришёл.
    const lifting = guardState({
      fleets: [
        raider(inboundToH(10)),
        fl('F1', 'p1', {
          location: 'H',
          units: stacks([['cruiser', 1]]),
          loading: [{ unit: 'militia', count: 4, from: 'H', startAt: NOW, doneAt: NOW + HOUR }],
        }),
      ],
      hGarrison: stacks([['militia', 4]]),
    });
    // …и молчит: журнал рассказывает о решении, а не о состоянии, иначе одна
    // эвакуация переписывалась бы в него каждый тик этого часа.
    expect(stewardGuardOrders(lifting, 'p1')).toEqual([]);
    // The wiring: a delegated «Оборона» tick carries the same orders.
    const viaAi = aiOrders(s, 'p1', 'defend').filter((a) => a.type === 'army.load' || a.type === 'fleet.move');
    expect(viaAi.map((a) => a.type)).toEqual(['army.load']);
  });

  it('an acceptable stand (forecast losses under the limit) holds the line — journal only', () => {
    const s = guardState({
      fleets: [fl('E1', 'p2', { units: stacks([['scout', 1]]), ...inboundToH(10) }), fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 2]]) })],
    });
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['steward.report']);
    expect(reportEntries(orders)).toMatchObject([{ kind: 'hold', node: 'H' }]);
  });

  it('nowhere safer to run — the wing stands and fights (a forced hold, journaled)', () => {
    const s = guardState({
      fleets: [raider(inboundToH(10)), fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 1]]) })],
      ownS: false, // the only owned world IS the threatened one
    });
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['steward.report']);
    const entries = reportEntries(orders);
    expect(entries).toMatchObject([{ kind: 'hold', node: 'H' }]);
    expect(entries[0]!.fraction as number).toBeGreaterThan(0.35); // the bad forecast explains the stand
  });

  it('a stranded garrison summons the nearest free-hold transport — if it beats the threat', () => {
    const s = guardState({
      fleets: [raider(inboundToH(20)), fl('F2', 'p1', { location: 'S', units: stacks([['strike_carrier', 1]]) })],
      hGarrison: stacks([['militia', 4]]),
    });
    const orders = stewardGuardOrders(s, 'p1');
    // S→H is ~3 game-hours at landing-ship speed + the 2h tick margin — well inside 20h.
    expect(orders.map((a) => a.type)).toEqual(['fleet.move', 'steward.report']);
    expect(orders[0]!.payload).toMatchObject({ fleetId: 'F2', to: 'H' });
    expect(reportEntries(orders)).toMatchObject([{ kind: 'ferry', node: 'H', fleetId: 'F2' }]);
  });

  it('a transport that cannot arrive before the assault is not fed into it — «не спасти» is journaled', () => {
    const s = guardState({
      fleets: [raider(inboundToH(3)), fl('F2', 'p1', { location: 'S', units: stacks([['strike_carrier', 1]]) })],
      hGarrison: stacks([['militia', 4]]),
    });
    // ~2.3h travel + 2h margin > 3h to impact — summoning would deliver it into the battle.
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['steward.report']);
    expect(reportEntries(orders)).toMatchObject([{ kind: 'stranded', node: 'H' }]);
  });

  it('one ferry already inbound — a second is not dispatched', () => {
    const s = guardState({
      fleets: [
        raider(inboundToH(20)),
        fl('F2', 'p1', {
          units: stacks([['strike_carrier', 1]]),
          movement: { from: 'S', to: 'H', departedAt: NOW - 1 * HOUR, arrivesAt: NOW + 1 * HOUR },
        }),
        fl('F3', 'p1', { location: 'S', units: stacks([['strike_carrier', 1]]) }),
      ],
      hGarrison: stacks([['militia', 4]]),
    });
    expect(stewardGuardOrders(s, 'p1')).toEqual([]);
  });

  it('a stand the forecast WINS is held at any price — a cheap feint cannot push the wing off', () => {
    // 3 scouts (~60 metal) vs a docked cruiser: the cruiser wins outright but
    // loses 50% hull — over the 35% limit. Fleeing would gift the world to the
    // feint (walk-in capture of an empty rock); the outcome gate holds instead.
    const s = guardState({
      fleets: [fl('E1', 'p2', { units: stacks([['scout', 3]]), ...inboundToH(10) }), fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 1]]) })],
    });
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['steward.report']);
    expect(reportEntries(orders)).toMatchObject([{ kind: 'hold', node: 'H', fraction: 0.5 }]);
  });

  it('never poaches the ferry off ANOTHER threatened node — that node lifts its own garrison in place', () => {
    // H and S are both threatened (S by a through-H journey), R is the safe rear.
    // H has a stranded garrison and no transport; the only free hold is the
    // landing ship docked at S. It must serve S (load + fly to R), not fly empty to H.
    const s = guardState({
      withR: true,
      fleets: [
        raider(inboundToH(20)),
        fl('E2', 'p2', {
          units: stacks([['cruiser', 4]]),
          movement: { from: 'E', to: 'H', departedAt: NOW - 1 * HOUR, arrivesAt: NOW + 8 * HOUR, path: ['S'], destination: 'S' },
        }),
        fl('F2', 'p1', { location: 'S', units: stacks([['strike_carrier', 1]]) }),
      ],
      hGarrison: stacks([['militia', 4]]),
      sGarrison: stacks([['militia', 2]]),
    });
    const orders = stewardGuardOrders(s, 'p1');
    // Подъём занимает час (CARGO-1) — этот тик грузит, вылет будет следующим.
    expect(orders.map((a) => a.type)).toEqual(['army.load', 'steward.report']);
    expect(orders[0]!.payload).toMatchObject({ fleetId: 'F2', unit: 'militia', count: 2 });
    // The journal narrates BOTH nodes: H's garrison is stranded (its only ferry
    // is needed at S), S's wing evacuates to the rear.
    expect(reportEntries(orders)).toMatchObject([
      { kind: 'stranded', node: 'H' },
      { kind: 'evac', node: 'S', to: 'R' },
    ]);
  });

  it('battle-worn troops cannot embark: no load is planned for them (it would bounce off E_NO_ARMY)', () => {
    // army.load resolves via findHealthyStack — a damaged stack never loads.
    // Planning it anyway would fire a doomed order AND mark the garrison as
    // handled; the fleet still saves itself.
    const s = guardState({
      fleets: [raider(inboundToH(10)), fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 1]]) })],
      hGarrison: [{ unit: 'militia', count: 4, hp: 40 }],
    });
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['fleet.move', 'steward.report']);
    expect(orders[0]!.payload).toMatchObject({ fleetId: 'F1', to: 'S' });
  });

  it('анти-шаттл: недавняя эвакуация H→S блокирует обратный рейс — крыло стоит и дерётся у S', () => {
    // The enemy re-targets the very node the wing just fled INTO. The only other
    // haven is H — the reverse leg of the shuttle. Blocked → forced hold at S.
    const s = guardState({
      fleets: [
        fl('E1', 'p2', {
          units: stacks([['cruiser', 4]]),
          movement: { from: 'E', to: 'H', departedAt: NOW - 1 * HOUR, arrivesAt: NOW + 4 * HOUR, path: ['S'], destination: 'S' },
        }),
        fl('F1', 'p1', { location: 'S', units: stacks([['cruiser', 1]]) }),
      ],
    });
    s.players.p1!.stewardLog = [{ at: NOW - 2 * HOUR, kind: 'evac', node: 'H', to: 'S', count: 1, fraction: 1 }];
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['steward.report']);
    expect(reportEntries(orders)).toMatchObject([{ kind: 'hold', node: 'S' }]);
  });

  it('анти-шаттл: кулдаун истёк — обратный рейс снова разрешён', () => {
    const s = guardState({
      fleets: [
        fl('E1', 'p2', {
          units: stacks([['cruiser', 4]]),
          movement: { from: 'E', to: 'H', departedAt: NOW - 1 * HOUR, arrivesAt: NOW + 4 * HOUR, path: ['S'], destination: 'S' },
        }),
        fl('F1', 'p1', { location: 'S', units: stacks([['cruiser', 1]]) }),
      ],
    });
    s.players.p1!.stewardLog = [{ at: NOW - 20 * HOUR, kind: 'evac', node: 'H', to: 'S', count: 1, fraction: 1 }];
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['fleet.move', 'steward.report']);
    expect(orders[0]!.payload).toMatchObject({ fleetId: 'F1', to: 'H' });
  });

  it('анти-шаттл: третий безопасный мир обходит блок — крыло уходит туда, а не назад', () => {
    const s = guardState({
      withR: true,
      fleets: [
        fl('E1', 'p2', {
          units: stacks([['cruiser', 4]]),
          movement: { from: 'E', to: 'H', departedAt: NOW - 1 * HOUR, arrivesAt: NOW + 4 * HOUR, path: ['S'], destination: 'S' },
        }),
        fl('F1', 'p1', { location: 'S', units: stacks([['cruiser', 1]]) }),
      ],
    });
    s.players.p1!.stewardLog = [{ at: NOW - 2 * HOUR, kind: 'evac', node: 'H', to: 'S', count: 1, fraction: 1 }];
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['fleet.move', 'steward.report']);
    expect(orders[0]!.payload).toMatchObject({ fleetId: 'F1', to: 'R' });
  });

  it('repeat-prone journal lines are stamped once per episode: an applied hold is not re-logged', () => {
    const s = guardState({
      fleets: [fl('E1', 'p2', { units: stacks([['scout', 1]]), ...inboundToH(10) }), fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 2]]) })],
    });
    const first = stewardGuardOrders(s, 'p1');
    expect(reportEntries(first)).toMatchObject([{ kind: 'hold', node: 'H' }]);
    // Apply the stamp through the real kernel (the journal lands in state)…
    const r = order(s, first[first.length - 1]!, s.time);
    expect(r.error).toBeUndefined();
    // …and the stateless re-tick stays silent instead of re-narrating the hold.
    expect(stewardGuardOrders(r.state, 'p1')).toEqual([]);
  });

  it('multi-tick, through the REAL kernel: summon → dock → lift → leave, then the driver goes quiet', () => {
    let s = guardState({
      fleets: [raider(inboundToH(20)), fl('F2', 'p1', { location: 'S', units: stacks([['strike_carrier', 1]]) })],
      hGarrison: stacks([['militia', 4]]),
    });
    const apply = (orders: ReturnType<typeof stewardGuardOrders>): void => {
      for (const a of orders) {
        const r = order(s, a, s.time);
        expect(r.error).toBeUndefined();
        s = r.state;
      }
    };
    // Tick 1: the ferry is summoned across (and journaled — the stamp applies too).
    const tick1 = stewardGuardOrders(s, 'p1');
    expect(tick1.map((a) => a.type)).toEqual(['fleet.move', 'steward.report']);
    apply(tick1);
    expect(s.fleets.F2!.movement).toMatchObject({ to: 'H' });
    expect(s.players.p1!.stewardLog).toMatchObject([{ kind: 'ferry', node: 'H' }]);
    // It docks (~2.3h) well before the 20h impact.
    const adv = advance(s, NOW + 4 * HOUR);
    expect(adv.error).toBeUndefined();
    s = adv.state;
    expect(s.fleets.F2!.location).toBe('H');
    // Tick 2: the docked branch ORDERS the lift — and only the lift. Подъём занимает
    // час (CARGO-1), а вылет его отменяет, поэтому паром в этот тик стоит.
    const tick2 = stewardGuardOrders(s, 'p1');
    expect(tick2.map((a) => a.type)).toEqual(['army.load', 'steward.report']);
    apply(tick2);
    expect(s.planets.H!.garrison).toEqual([{ unit: 'militia', count: 4 }]); // ещё на земле
    expect(s.fleets.F2!.loading).toMatchObject([{ unit: 'militia', count: 4, from: 'H' }]);
    expect(s.fleets.F2!.movement).toBeNull();
    // Tick 2а: пока час идёт, драйвер молчит — второй раз ту же роту он не заказывает
    // и паром не угоняет.
    expect(stewardGuardOrders(s, 'p1')).toEqual([]);
    // Час прошёл — рота на борту, гарнизон пуст.
    const lifted = advance(s, s.time + HOUR);
    expect(lifted.error).toBeUndefined();
    s = lifted.state;
    expect(s.planets.H!.garrison).toEqual([]);
    expect(s.fleets.F2!.landing).toMatchObject([{ unit: 'militia', count: 4 }]);
    expect(s.fleets.F2!.loading).toBeUndefined();
    // Tick 3: трюм полон, держать больше нечего — паром уходит в тыл.
    const tick3 = stewardGuardOrders(s, 'p1');
    expect(tick3.map((a) => a.type)).toEqual(['fleet.move', 'steward.report']);
    apply(tick3);
    expect(s.fleets.F2!.movement).toMatchObject({ to: 'S' });
    // The journal now narrates the whole rescue, oldest first.
    expect(s.players.p1!.stewardLog).toMatchObject([
      { kind: 'ferry', node: 'H' },
      { kind: 'evac', node: 'H', to: 'S', count: 1 },
      { kind: 'evac', node: 'H', to: 'S', count: 1 },
    ]);
    // Tick 4: nothing left to protect at H — the driver re-runs to silence.
    expect(stewardGuardOrders(s, 'p1')).toEqual([]);
  });
  it('ВАХТА СТАВИТСЯ НА СВОЙ МИР с эскадрой в ангаре (SHU-2.2 — раньше на флот)', () => {
    const s = guardState({ fleets: [] });
    s.planets.H = {
      ...s.planets.H!,
      hangar: [{ id: 'sq:p1:1', units: [{ unit: 'interceptor', count: 2 }] }],
    };
    const active = stewardGuardOrders(s, 'p1', 'active_defend');
    expect(active.map((a) => a.type)).toEqual(['order.scramble', 'steward.report']);
    expect(active[0]!.payload).toMatchObject({ planetId: 'H', on: true });
    expect(reportEntries(active)).toMatchObject([{ kind: 'watch', node: 'H' }]);
    // Вне «Активной обороны» вахта не ставится вовсе.
    expect(stewardGuardOrders(s, 'p1', 'defend')).toEqual([]);
  });

  it('ПУСТОЙ АНГАР ВАХТЫ НЕ ПОЛУЧАЕТ: дежурить нечем', () => {
    const s = guardState({ fleets: [] });
    expect(stewardGuardOrders(s, 'p1', 'active_defend')).toEqual([]);
  });

  it('точка удержания (ST-2.1): якорь НИКОГДА не эвакуируется — без подмоги это вынужденный hold', () => {
    // The same doomed stand the first test evacuates — but H is a hold point and
    // no relief exists anywhere: the wing stands as ordered, the bad fraction in
    // the journal tells the owner the price of their standing order.
    const s = guardState({
      fleets: [raider(inboundToH(10)), fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 1]]) })],
      hGarrison: stacks([['militia', 4]]),
    });
    s.players.p1!.stewardHoldPoints = ['H'];
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['steward.report']);
    const entries = reportEntries(orders);
    expect(entries).toMatchObject([{ kind: 'hold', node: 'H' }]);
    expect(entries[0]!.fraction as number).toBeGreaterThanOrEqual(0.35);
  });

  it('точка удержания: подкрепление, которое успевает И переламывает прогноз, вылетает к якорю', () => {
    let s = guardState({
      fleets: [
        raider(inboundToH(20)),
        fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 1]]) }),
        fl('F2', 'p1', { location: 'S', units: stacks([['cruiser', 8]]) }),
      ],
    });
    s.players.p1!.stewardHoldPoints = ['H'];
    const tick1 = stewardGuardOrders(s, 'p1');
    expect(tick1.map((a) => a.type)).toEqual(['fleet.move', 'steward.report']);
    expect(tick1[0]!.payload).toMatchObject({ fleetId: 'F2', to: 'H' });
    expect(reportEntries(tick1)).toMatchObject([{ kind: 'reinforce', node: 'H', fleetId: 'F2' }]);
    // Apply through the real kernel: while the relief flies, the driver adds nothing…
    for (const a of tick1) {
      const r = order(s, a, s.time);
      expect(r.error).toBeUndefined();
      s = r.state;
    }
    expect(stewardGuardOrders(s, 'p1')).toEqual([]);
    // …and once it docks, the combined stand HOLDS — the anchor was never evacuated.
    const adv = advance(s, NOW + 4 * HOUR);
    expect(adv.error).toBeUndefined();
    s = adv.state;
    expect(s.fleets.F2!.location).toBe('H');
    const tick2 = stewardGuardOrders(s, 'p1');
    expect(tick2.map((a) => a.type)).toEqual(['steward.report']);
    expect(reportEntries(tick2)).toMatchObject([{ kind: 'hold', node: 'H' }]);
  });

  it('точка удержания: подмога, не успевающая до удара, не вылетает (piecemeal отклонён)', () => {
    // ~2.3h travel + 2h tick margin > 3h to impact — the relief would arrive
    // into the assault and feed the enemy piecemeal; the anchor stands alone.
    const s = guardState({
      fleets: [
        raider(inboundToH(3)),
        fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 1]]) }),
        fl('F2', 'p1', { location: 'S', units: stacks([['cruiser', 8]]) }),
      ],
    });
    s.players.p1!.stewardHoldPoints = ['H'];
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['steward.report']);
    expect(reportEntries(orders)).toMatchObject([{ kind: 'hold', node: 'H' }]);
  });

  it('точка удержания: слишком слабая подмога не переламывает прогноз — не скармливается', () => {
    const s = guardState({
      fleets: [
        raider(inboundToH(20)),
        fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 1]]) }),
        fl('F2', 'p1', { location: 'S', units: stacks([['cruiser', 1]]) }),
      ],
    });
    s.players.p1!.stewardHoldPoints = ['H'];
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['steward.report']);
    expect(reportEntries(orders)).toMatchObject([{ kind: 'hold', node: 'H' }]);
  });

  it('точка удержания: паром для чужой эвакуации не снимается с якоря', () => {
    // H's garrison is stranded; the only transport sits docked at the anchor S —
    // it stays (the anchor keeps its wing), so H journals «не спасти».
    const s = guardState({
      fleets: [raider(inboundToH(20)), fl('F2', 'p1', { location: 'S', units: stacks([['strike_carrier', 1]]) })],
      hGarrison: stacks([['militia', 4]]),
    });
    s.players.p1!.stewardHoldPoints = ['S'];
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['steward.report']);
    expect(reportEntries(orders)).toMatchObject([{ kind: 'stranded', node: 'H' }]);
  });

  it('under an active assault the garrison is locked — fleets still fly out, nothing is loaded', () => {
    const s = guardState({
      fleets: [raider({ location: 'H' }), fl('F1', 'p1', { location: 'H', units: stacks([['cruiser', 1]]) })],
      hGarrison: stacks([['militia', 4]]),
      battles: {
        b1: {
          id: 'b1',
          location: 'H',
          phase: 'ground',
          attacker: { ref: { kind: 'landing', fleetId: 'E1' }, owner: 'p2' },
          defender: { ref: { kind: 'garrison', planetId: 'H' }, owner: 'p1' },
          round: 1,
        },
      },
    });
    const orders = stewardGuardOrders(s, 'p1');
    expect(orders.map((a) => a.type)).toEqual(['fleet.move', 'steward.report']);
    expect(orders[0]!.payload).toMatchObject({ fleetId: 'F1', to: 'S' });
  });
});
