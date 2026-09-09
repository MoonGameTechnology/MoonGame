import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { constructionModule } from './construction';
import { economyModule } from './economy';
import {
  createInitialState,
  type BuildingInstance,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';
import { visibleState } from '../state/visibility';
import type { GameModule } from '../kernel/module';

// BLD-1 — очередь стройки. Находка владельца на плейтесте: «каждая новая постройка
// переопределяла предыдущую, ресурсы тратились, ничего не строилось». Ядро принимало
// все заказы и вело их ПАРАЛЛЕЛЬНО; на экране оставался один. Здесь сторожится новое
// правило: одна стройка на полосу, остальное ждёт и стартует само.
//
// mine: 50 metal, 4ч, даёт 10 metal/ч. fort: 20 metal + 5 credits, 1ч, апгрейд 40/2ч.
// cruiser: 10 metal, 2ч. drone: 3 metal, 0ч.
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits'],
  units: {
    cruiser: {
      faction: 'x',
      stats: { attack: 5, defense: 5, speed: 5, hp: 40 },
      cost: { metal: 10 },
      buildTimeHours: 2,
    },
    drone: {
      faction: 'x',
      stats: { attack: 1, defense: 1, speed: 10, hp: 6 },
      cost: { metal: 3 },
      buildTimeHours: 1,
    },
  },
  factions: {},
  buildings: {
    mine: { name: 'Mine', cost: { metal: 50 }, buildTimeHours: 4, produces: { metal: 10 } },
    fort: {
      name: 'Fort',
      cost: { metal: 20, credits: 5 },
      buildTimeHours: 1,
      hp: 30,
      upgrades: [{ cost: { metal: 40 }, buildTimeHours: 2, hp: 60 }],
    },
    shipyard: {
      name: 'Shipyard',
      cost: { metal: 100 },
      buildTimeHours: 4,
      hp: 20,
      enablesShipConstruction: true,
    },
  },
  events: {},
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });

function player(id: string, resources: Record<string, number> = {}): Player {
  return { id, name: id, faction: 'x', status: 'active', resources };
}
function planet(id: string, owner: string | null, buildings: BuildingInstance[] = []): Planet {
  return { id, owner, position: { x: 0, y: 0 }, resources: {}, buildings, garrison: [], traits: [] };
}
function stateWith(opts: { players?: Player[]; planets?: Planet[] }): GameState {
  const s = createInitialState({ seed: 'q', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const x of opts.players ?? []) players[x.id] = x;
  const planets: Record<string, Planet> = {};
  for (const x of opts.planets ?? []) planets[x.id] = x;
  return { ...s, players, planets };
}
function construct(building: string, planetId = 'A', playerId = 'p1'): Action {
  return {
    id: `s:${playerId}:c:${building}`,
    type: 'building.construct',
    playerId,
    payload: { planetId, building },
    issuedAt: 0,
  };
}
function upgrade(building: string, planetId = 'A', playerId = 'p1'): Action {
  return {
    id: `s:${playerId}:u:${building}`,
    type: 'building.upgrade',
    playerId,
    payload: { planetId, building },
    issuedAt: 0,
  };
}
function build(unit: string, count: number | undefined, planetId = 'A', playerId = 'p1'): Action {
  return {
    id: `s:${playerId}:b:${unit}:${count ?? 1}`,
    type: 'unit.build',
    playerId,
    payload: { planetId, unit, count },
    issuedAt: 0,
  };
}
function cancel(seq: number, planetId = 'A', playerId = 'p1'): Action {
  return {
    id: `s:${playerId}:x:${seq}`,
    type: 'construction.cancel',
    playerId,
    payload: { planetId, seq },
    issuedAt: 0,
  };
}
function okApply(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function okAdvance(r: AdvanceResult) {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}
/** `seq` идущей стройки — им её отменяют. */
function activeSeq(state: GameState): number {
  const e = state.scheduled.find((x) => x.type === 'construction.complete');
  if (!e) throw new Error('нет идущей стройки');
  return e.seq;
}

describe('BLD-1 — вторая постройка встаёт в очередь, а не рядом', () => {
  it('второй заказ не строится параллельно и НЕ СПИСЫВАЕТ денег', () => {
    const kernel = createKernel([constructionModule]);
    const st = stateWith({
      players: [player('p1', { metal: 200, credits: 50 })],
      planets: [planet('A', 'p1')],
    });

    const first = okApply(kernel.applyAction(st, construct('mine'), ctx(0)));
    expect(first.state.players.p1?.resources.metal).toBe(150); // 200 − 50, голова оплачена

    const second = okApply(kernel.applyAction(first.state, construct('fort'), ctx(0)));
    // Вот он, баг с плейтеста: раньше здесь списывались ещё 20 metal + 5 credits и
    // заводилось ВТОРОЕ событие завершения, которого игрок никогда не видел.
    expect(second.state.players.p1?.resources.metal).toBe(150);
    expect(second.state.players.p1?.resources.credits).toBe(50);
    expect(
      second.state.scheduled.filter((e) => e.type === 'construction.complete'),
    ).toHaveLength(1);
    expect(second.state.planets.A?.buildQueue?.map((q) => q.building)).toEqual(['fort']);
    expect(second.events.map((e) => e.type)).toContain('construction.queued');
  });

  it('голова достроилась — следующий стартует САМ и платит в этот момент', () => {
    const kernel = createKernel([constructionModule]);
    const st = stateWith({
      players: [player('p1', { metal: 200, credits: 50 })],
      planets: [planet('A', 'p1')],
    });
    const ordered = okApply(
      kernel.applyAction(
        okApply(kernel.applyAction(st, construct('mine'), ctx(0))).state,
        construct('fort'),
        ctx(0),
      ),
    );

    // Шахта готова в +4ч — и ровно тогда с очереди снимается форт.
    const done = okAdvance(kernel.advanceTo(ordered.state, ctx(4 * HOUR)));
    expect(done.state.planets.A?.buildings.map((b) => b.type)).toEqual(['mine']);
    expect(done.state.planets.A?.buildQueue).toBeUndefined();
    expect(done.state.players.p1?.resources.metal).toBe(130); // 150 − 20 списаны на СТАРТЕ
    expect(done.state.players.p1?.resources.credits).toBe(45);
    expect(done.events.map((e) => e.type)).toContain('construction.started');

    // …и достраивается своим чередом ещё через час.
    const later = okAdvance(kernel.advanceTo(done.state, ctx(5 * HOUR)));
    expect(later.state.planets.A?.buildings.map((b) => b.type)).toEqual(['mine', 'fort']);
  });

  it('очередь держит порядок заказов: третий ждёт второго', () => {
    const kernel = createKernel([constructionModule]);
    let s = stateWith({
      players: [player('p1', { metal: 300, credits: 50 })],
      planets: [planet('A', 'p1')],
    });
    for (const a of [construct('mine'), construct('fort'), construct('shipyard')]) {
      s = okApply(kernel.applyAction(s, a, ctx(0))).state;
    }
    expect(s.planets.A?.buildQueue?.map((q) => q.building)).toEqual(['fort', 'shipyard']);

    const afterMine = okAdvance(kernel.advanceTo(s, ctx(4 * HOUR))).state;
    expect(afterMine.planets.A?.buildQueue?.map((q) => q.building)).toEqual(['shipyard']);
    const afterFort = okAdvance(kernel.advanceTo(afterMine, ctx(5 * HOUR))).state;
    expect(afterFort.planets.A?.buildQueue).toBeUndefined();
    const afterYard = okAdvance(kernel.advanceTo(afterFort, ctx(9 * HOUR))).state;
    expect(afterYard.planets.A?.buildings.map((b) => b.type)).toEqual([
      'mine',
      'fort',
      'shipyard',
    ]);
  });

  it('апгрейд спорит со стройкой за ОДНУ полосу, а верфь идёт своей', () => {
    const kernel = createKernel([constructionModule]);
    const st = stateWith({
      players: [player('p1', { metal: 400, credits: 50 })],
      planets: [
        planet('A', 'p1', [
          { uid: 'f1', type: 'fort', level: 1, hp: 30 },
          { uid: 'y1', type: 'shipyard', level: 1, hp: 20 },
        ]),
      ],
    });
    const a = okApply(kernel.applyAction(st, construct('mine'), ctx(0)));
    // Апгрейд — та же стройплощадка: в очередь.
    const b = okApply(kernel.applyAction(a.state, upgrade('fort'), ctx(0)));
    expect(b.state.planets.A?.buildQueue?.map((q) => q.kind)).toEqual(['upgrade']);
    // Верфь — независимая полоса: стартует немедленно, параллельно шахте.
    const c = okApply(kernel.applyAction(b.state, build('cruiser', 1), ctx(0)));
    expect(c.state.planets.A?.buildQueue?.map((q) => q.kind)).toEqual(['upgrade']);
    expect(c.state.scheduled.filter((e) => e.type === 'construction.complete')).toHaveLength(2);
    expect(c.state.players.p1?.resources.metal).toBe(340); // 400 − 50 шахта − 10 крейсер
  });

  it('второй корабль ждёт первого — у верфи очередь своя', () => {
    const kernel = createKernel([constructionModule]);
    const st = stateWith({
      players: [player('p1', { metal: 100 })],
      planets: [planet('A', 'p1', [{ uid: 'y1', type: 'shipyard', level: 1, hp: 20 }])],
    });
    const a = okApply(kernel.applyAction(st, build('cruiser', 1), ctx(0)));
    const b = okApply(kernel.applyAction(a.state, build('drone', 2), ctx(0)));
    expect(b.state.players.p1?.resources.metal).toBe(90); // за дронов пока не платили
    expect(b.state.planets.A?.buildQueue?.map((q) => q.unit)).toEqual(['drone']);

    const built = okAdvance(kernel.advanceTo(b.state, ctx(2 * HOUR)));
    expect(built.state.players.p1?.resources.metal).toBe(84); // 2 дрона по 3 — на старте
    const later = okAdvance(kernel.advanceTo(built.state, ctx(3 * HOUR)));
    expect(later.state.planets.A?.garrison.find((g) => g.unit === 'drone')?.count).toBe(2);
  });
});

describe('BLD-1 — деньги проверяются там же, где стартуют', () => {
  it('свободная полоса и пустой карман — прежний E_INSUFFICIENT, а не тихая очередь', () => {
    const kernel = createKernel([constructionModule]);
    const st = stateWith({ players: [player('p1', { metal: 10 })], planets: [planet('A', 'p1')] });
    expect(errCode(kernel.applyAction(st, construct('mine'), ctx(0)))).toBe('E_INSUFFICIENT');
    expect(st.planets.A?.buildQueue).toBeUndefined();
  });

  it('голова без денег ЖДЁТ и стартует сама, когда шахта их накопит', () => {
    const kernel = createKernel([economyModule, constructionModule]);
    // Ровно на форт (20+5) и ни монетой больше: шахта в очереди дождётся выработки.
    const st = stateWith({
      players: [player('p1', { metal: 20, credits: 5 })],
      planets: [planet('A', 'p1', [{ uid: 'm1', type: 'mine', level: 1, hp: 10 }])],
    });
    const a = okApply(kernel.applyAction(st, construct('fort'), ctx(0)));
    const b = okApply(kernel.applyAction(a.state, construct('shipyard'), ctx(0)));
    expect(b.state.planets.A?.buildQueue?.map((q) => q.building)).toEqual(['shipyard']);

    // +1ч: форт готов, но на верфь (100) накоплено лишь ~10 — очередь ЖДЁТ.
    const hour1 = okAdvance(kernel.advanceTo(b.state, ctx(HOUR)));
    expect(hour1.state.planets.A?.buildings.map((x) => x.type)).toEqual(['mine', 'fort']);
    expect(hour1.state.planets.A?.buildQueue?.map((q) => q.building)).toEqual(['shipyard']);
    expect(hour1.state.scheduled.some((e) => e.type === 'construction.queue.pump')).toBe(true);

    // Дальше повтор раз в игровой час сам находит момент, когда денег хватило.
    const later = okAdvance(kernel.advanceTo(hour1.state, ctx(12 * HOUR)));
    expect(later.state.planets.A?.buildQueue).toBeUndefined();
    expect(
      later.state.scheduled.some((e) => e.type === 'construction.complete'),
    ).toBe(true);
    expect(later.state.players.p1!.resources.metal!).toBeLessThan(100);
  });

  it('повтор не плодит дублей и затихает, когда очередь опустела', () => {
    const kernel = createKernel([economyModule, constructionModule]);
    const st = stateWith({
      players: [player('p1', { metal: 20, credits: 5 })],
      planets: [planet('A', 'p1', [{ uid: 'm1', type: 'mine', level: 1, hp: 10 }])],
    });
    const a = okApply(kernel.applyAction(st, construct('fort'), ctx(0)));
    const b = okApply(kernel.applyAction(a.state, construct('shipyard'), ctx(0)));
    const waiting = okAdvance(kernel.advanceTo(b.state, ctx(3 * HOUR)));
    expect(
      waiting.state.scheduled.filter((e) => e.type === 'construction.queue.pump'),
    ).toHaveLength(1);
    // Верфь оплачена и строится → новых повторов не назначается.
    const started = okAdvance(kernel.advanceTo(waiting.state, ctx(20 * HOUR)));
    expect(started.state.scheduled.filter((e) => e.type === 'construction.queue.pump')).toEqual(
      [],
    );
  });
});

describe('BLD-1 — отмена, потолок, захват, туман', () => {
  it('ждущий заказ отменяется той же кнопкой и ничего не возвращает — он не оплачен', () => {
    const kernel = createKernel([constructionModule]);
    const st = stateWith({
      players: [player('p1', { metal: 200, credits: 50 })],
      planets: [planet('A', 'p1')],
    });
    const a = okApply(kernel.applyAction(st, construct('mine'), ctx(0)));
    const b = okApply(kernel.applyAction(a.state, construct('fort'), ctx(0)));
    const waitingId = b.state.planets.A!.buildQueue![0]!.id;

    const c = okApply(kernel.applyAction(b.state, cancel(waitingId), ctx(0)));
    expect(c.state.planets.A?.buildQueue).toBeUndefined();
    expect(c.state.players.p1?.resources.metal).toBe(150); // ни возврата, ни списания
    // И это НЕ приостановленная стройка: возобновлять нечего.
    expect(c.state.planets.A?.pausedConstruction).toBeUndefined();
    expect(c.events.map((e) => e.type)).toContain('construction.cancelled');
  });

  it('отмена идущей стройки немедленно пускает следующего — ради этого она и кнопка', () => {
    const kernel = createKernel([constructionModule]);
    const st = stateWith({
      players: [player('p1', { metal: 200, credits: 50 })],
      planets: [planet('A', 'p1')],
    });
    const a = okApply(kernel.applyAction(st, construct('mine'), ctx(0)));
    const b = okApply(kernel.applyAction(a.state, construct('fort'), ctx(0)));
    const c = okApply(kernel.applyAction(b.state, cancel(activeSeq(b.state)), ctx(0)));

    expect(c.state.planets.A?.buildQueue).toBeUndefined();
    expect(c.state.planets.A?.pausedConstruction).toHaveLength(1);
    const active = c.state.scheduled.filter((e) => e.type === 'construction.complete');
    expect(active).toHaveLength(1);
    expect((active[0]!.payload as { building?: string }).building).toBe('fort');
    expect(c.state.players.p1?.resources.metal).toBe(180); // 150 + 50 возврат − 20 форт
  });

  it('очередь полосы ограничена — сверх потолка отказ, а не рост состояния', () => {
    // Проверяется на полосе ВЕРФИ: потолок один на обе (`enqueueOrder` не знает, чья
    // полоса), а одинаковые корабли заказывать можно — в отличие от зданий, где
    // повтор отбивает `E_ALREADY_QUEUED` раньше потолка.
    const kernel = createKernel([constructionModule]);
    let s = stateWith({
      players: [player('p1', { metal: 5000 })],
      planets: [planet('A', 'p1', [{ uid: 'y1', type: 'shipyard', level: 1, hp: 20 }])],
    });
    // Одна идущая + пять ждущих = потолок.
    for (let i = 0; i < 6; i++) {
      s = okApply(kernel.applyAction(s, build('cruiser', i + 1), ctx(0))).state;
    }
    expect(s.planets.A?.buildQueue).toHaveLength(5);
    expect(errCode(kernel.applyAction(s, build('cruiser', 7), ctx(0)))).toBe('E_QUEUE_FULL');
  });

  it('захват мира стирает очередь прежнего хозяина', () => {
    // `planet.captured` приходит по шине от боевых модулей; здесь его подаёт крошечный
    // модуль-звонок — проверяется именно ПОДПИСКА стройки, а не путь захвата.
    const capture: GameModule = {
      id: 'test-capture',
      version: '1.0.0',
      setup(api) {
        api.onAction('test.capture', (action, h) => {
          const p = action.payload as { planetId: string; owner: string };
          const target = h.state.planets[p.planetId];
          if (target) target.owner = p.owner;
          h.emit('planet.captured', { planetId: p.planetId, owner: p.owner });
        });
      },
    };
    const kernel = createKernel([constructionModule, capture]);
    const st = stateWith({
      players: [player('p1', { metal: 300, credits: 50 }), player('p2', {})],
      planets: [planet('A', 'p1')],
    });
    const a = okApply(kernel.applyAction(st, construct('mine'), ctx(0)));
    const b = okApply(kernel.applyAction(a.state, construct('fort'), ctx(0)));
    expect(b.state.planets.A?.buildQueue).toHaveLength(1);

    const taken = okApply(
      kernel.applyAction(
        b.state,
        {
          id: 's:p2:cap',
          type: 'test.capture',
          playerId: 'p2',
          payload: { planetId: 'A', owner: 'p2' },
          issuedAt: 0,
        },
        ctx(0),
      ),
    );
    expect(taken.state.planets.A?.buildQueue).toBeUndefined();
  });

  it('одно и то же здание не встаёт в очередь дважды', () => {
    const kernel = createKernel([constructionModule]);
    const st = stateWith({
      players: [player('p1', { metal: 300, credits: 50 })],
      planets: [planet('A', 'p1')],
    });
    const a = okApply(kernel.applyAction(st, construct('mine'), ctx(0)));
    const b = okApply(kernel.applyAction(a.state, construct('fort'), ctx(0)));
    expect(errCode(kernel.applyAction(b.state, construct('fort'), ctx(0)))).toBe(
      'E_ALREADY_QUEUED',
    );
  });

  it('очередь чужого мира не видна ДАЖЕ в упор — это намерение, а не наблюдение', () => {
    const kernel = createKernel([constructionModule]);
    const st = stateWith({
      players: [player('p1', { metal: 300, credits: 50 }), player('p2', {})],
      planets: [planet('A', 'p1')],
    });
    const a = okApply(kernel.applyAction(st, construct('mine'), ctx(0)));
    const b = okApply(kernel.applyAction(a.state, construct('fort'), ctx(0)));

    expect(visibleState(b.state, 'p1', data).planets.A?.buildQueue).toHaveLength(1);
    expect(visibleState(b.state, 'p2', data).planets.A?.buildQueue).toBeUndefined();
  });
});
