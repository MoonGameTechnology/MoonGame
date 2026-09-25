import { describe, it, expect, afterEach } from 'vitest';

import {
  advance,
  order,
  setMatchMode,
  setMatchTravelSpeed,
  setMatchVeteranPower,
  strikeShuttle,
} from './game';
import { data } from './gameData';
import { initSoloDrivers } from './soloDrivers';
import { pveState, pveModeId } from '../../packages/client/src/gameData';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { runAiSeats } from '../../decisions/runAiSeats';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import type { RunDifficulty } from '../../decisions/runDifficulty';

/**
 * AUD-20 — сценарий MC-01 (`sector-zero-roadmap.md` §3.9) на шипнутой карте `pve-1`,
 * через настоящие функции хоста: `advance`/`order` и те же `soloDrivers`, что гоняет
 * кадр прототипа. Рой водит бот забега, приказы Роя никто не подделывает.
 *
 * До аудита цепочка «удар → память → проект → перехват» была зелёной только в тесте
 * ядра: бот забега `swarm.adapt` не отправлял вовсе. Здесь она проходит целиком:
 * игрок бьёт волны Роя бомбардировщиками из порта своего дома → Рой набирает сигнал →
 * бот заказывает проект → покров вырастает на матках → следующий удар по матке встречает
 * перехват, которого раньше не было.
 *
 * Подготовка мира — единственная рука теста: дом игрока с портом, эскадрой
 * бомбардировщиков и тремя авианосцами (ещё три запаса вылетов), крепче обычного —
 * пассивный игрок забега падает раньше, чем Рой успевает дорастить форму, а мерить здесь
 * надо адаптацию, а не оборону, — и цепочка постов-ретрансляторов Роя до фронта: опыт
 * боя течёт только по сети (`docs/swarm-behavior.md`). Всё остальное — волны, их курс, бои у дома, решение Роя —
 * делает забег. Игрок бьёт, пока Рой не набрал сигнал, потом бережёт вылет до
 * проявления рецепта — ровно так, как проверял бы его живой игрок.
 */

const HOUR = 3_600_000;
const SQUAD = 'sq:bomber';
const CV_SQUAD = 'sq:cv';
const VEIL = 'swarm_intercept_veil';
/** Волн в прогоне. Главе I их 10, но к десятой Рой только успевает дорастить покров, а
 *  проверить надо ещё и удар ПОСЛЕ него — забегу даётся запас волн (рука теста, как дом). */
const RUN_WAVES = 16;

/** Правила ЗАБЕГА — те же, что ставит хост (`installMatch` + `setRunActive`): режим карты,
 *  темп перемещения ×5 и сила ветерана (VET-6). */
function armRun(): void {
  setMatchMode(pveModeId());
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
  setMatchVeteranPower(true);
}
function disarmRun(): void {
  setMatchMode(undefined);
  setMatchTravelSpeed(1);
  setMatchVeteranPower(false);
}

interface Mc01 {
  state: GameState;
  /** Часы, в которые удар попал по Рою, и сколько ответки он встретил — у цели или на
   *  подлёте. */
  hits: Array<{ hour: number; target: string }>;
  repelled: Array<{
    hour: number;
    target: string;
    damage: number;
    downed: number;
  }>;
  started?: { hour: number; moduleId: string };
  done?: { hour: number; touched: number };
  /** Час, когда ИИ Роя сам поставил пост-ретранслятор на `drift` — последнее звено сети до
   *  дома игрока. Не поставил — поля нет. */
  chainAt?: number;
  /** Сколько наблюдений знал улей до этого часа. */
  hiveBeforeChain: number;
}

/** Дом игрока с портом, эскадрой и авианосцами: стартовый флот без шаттлов, бить Рой
 *  ему нечем. Несколько баз — потому что у каждой свой запас вылетов. */
function armedHome(chain: boolean): GameState {
  const s = pveState(data);
  // Сеть Роя дотянута до фронта: к посту на `ridge` из данных карты — посты на `shoal` и
  // `drift`. Малый ретранслятор волны у дома игрока тогда достаёт до сети, и опыт боя
  // доходит до улья. Без цепочки он гибнет вместе с волной (`docs/swarm-behavior.md`).
  if (chain) {
    for (const at of ['shoal', 'drift']) {
      s.fleets[`post_${at}`] = {
        id: `post_${at}`,
        owner: 'p3',
        location: at,
        movement: null,
        units: [
          { unit: 'swarm_relay', count: 1 },
          { unit: 'frigate', count: 2 },
        ],
        traits: [],
        orbit: 'near',
      };
    }
  }
  const home = s.planets.home_a!;
  // Порт с запасом прочности (рука теста): после ROADS-8 волны доходят до дома плотнее,
  // и штатные 25 HP сносятся раньше, чем Рой дорастит покров, — удар ПОСЛЕ проявления,
  // предмет теста, вылетать было бы неоткуда.
  home.buildings = [...home.buildings, { type: 'spaceport', level: 1, hp: 400 }];
  home.hangar = [{ id: SQUAD, units: [{ unit: 'bomber', count: 3 }] }];
  home.garrison = [...home.garrison, { unit: 'heavy_infantry', count: 24 }];
  s.fleets.p1_2!.units = [{ unit: 'cruiser', count: 24 }];
  // Три авианосца — три запаса вылетов: перезарядка у баз медленная (AUD-27), а сигнал
  // Рою нужно дать за первые встречи с волнами, пока забег не кончился удержанием.
  for (const n of [1, 2, 3]) {
    s.fleets[`cv${n}`] = {
      id: `cv${n}`,
      owner: 'p1',
      location: 'home_a',
      movement: null,
      units: [{ unit: 'strike_carrier', count: 1 }],
      traits: [],
      orbit: 'near',
      hangar: [{ id: `${CV_SQUAD}${n}`, units: [{ unit: 'bomber', count: 3 }] }],
    };
  }
  return s;
}

function runMc01(difficulty: RunDifficulty, maxHours: number, chain = true): Mc01 {
  armRun();
  let s = armedHome(chain);
  let hour = 0;
  const out: Mc01 = { state: s, hits: [], repelled: [], hiveBeforeChain: 0 };
  const scan = (events: readonly { type: string; payload: unknown }[]): void => {
    for (const e of events) {
      const p = e.payload as Record<string, unknown>;
      if (e.type === 'shuttle.hit' && p.targetOwner === 'p3')
        out.hits.push({ hour, target: String(p.targetId) });
      // Перехват бывает двух видов: ответка у цели (`shuttle.repelled`) и зональное ПВО
      // флота Роя, сбивающее вылет ещё на подлёте (`pd.fired`). После ROADS-8 волна
      // продолжает марш, удар гонится за ней — и покров встречает его в погоне.
      if (e.type === 'pd.fired' && p.owner === 'p3' && p.targetOwner === 'p1')
        out.repelled.push({
          hour,
          target: String(p.fleetId),
          damage: Number(p.damage),
          downed: Number(p.downed ?? 0),
        });
      if (e.type === 'shuttle.repelled' && p.targetOwner === 'p3')
        out.repelled.push({
          hour,
          target: String(p.targetId),
          damage: Number(p.damage),
          downed: Number(p.downed ?? 0),
        });
      if (e.type === 'swarm.adapt.started' && !out.started)
        out.started = { hour, moduleId: String(p.moduleId) };
      // Отложенное событие проекта носит то же имя, что и объявление о нём; объявление —
      // то, где есть `touched`.
      if (e.type === 'swarm.adapt.done' && p.touched !== undefined && !out.done)
        out.done = { hour, touched: Number(p.touched) };
    }
  };
  const apply = (a: Action): void => {
    const r = order(s, a, s.time);
    if (r.error) return;
    s = r.state;
    scan(r.events);
  };
  const drivers = initSoloDrivers({
    state: () => s,
    me: () => 'p1',
    aiSeats: () => runAiSeats(s, 'p1', difficulty),
    applyLocal: apply,
    playerOrder: apply,
    autoAssault: () => false,
    patrols: () => new Map(),
    known: () => true,
  });
  for (hour = 1; hour <= maxHours; hour++) {
    const step = advance(s, hour * HOUR);
    s = step.state;
    scan(step.events);
    if (s.pve && s.pve.totalWaves < RUN_WAVES)
      s = { ...s, pve: { ...s.pve, totalWaves: RUN_WAVES } };
    if (s.match.status === 'ended') break;
    const posted = Object.values(s.fleets).some(
      (f) =>
        f.owner === 'p3' &&
        f.location === 'drift' &&
        f.movement === null &&
        f.units.some((u) => u.unit === 'swarm_relay' && u.count > 0),
    );
    if (posted) out.chainAt ??= hour;
    if (out.chainAt === undefined)
      out.hiveBeforeChain = s.swarmNet?.holders['planet:hive']?.known.length ?? 0;
    drivers.runAI();
    drivers.autoEngage();
    drivers.checkFleetClashes();
    // Игрок: флот Роя у дома — под удар, пока Рой не набрал сигнал; дальше вылет
    // бережётся до проявления рецепта. Отказ (нет топлива, эскадра в полёте) — не ошибка
    // теста, а жизнь базы: тогда пробуется вторая.
    const target = Object.values(s.fleets)
      .filter(
        (f) => f.owner === 'p3' && f.location === 'home_a' && f.units.some((u) => u.count > 0),
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    // Сигнал считается там, где он нужен, — у улья: наблюдение, погибшее вместе со
    // свидетелем вне сети, до проекта не доходит, и такой удар игрок повторяет.
    const signal = s.swarmNet?.holders['planet:hive']?.known.length ?? 0;
    const grown = (s.swarmRecipes?.[VEIL] ?? 0) > 0;
    if (target && (signal < 3 || grown)) {
      // Первая база, у которой есть вылет: порт, потом авианосцы по порядку.
      const bases = [
        strikeShuttle('p1', { planetId: 'home_a' }, SQUAD, {
          targetFleetId: target.id,
        }),
        ...[1, 2, 3].map((n) =>
          strikeShuttle('p1', { fleetId: `cv${n}` }, `${CV_SQUAD}${n}`, {
            targetFleetId: target.id,
          }),
        ),
      ];
      for (const order of bases) {
        const before = s;
        apply(order);
        if (s !== before) break;
      }
    }
  }
  out.state = s;
  return out;
}

describe('MC-01 на pve-1: удары шаттлов доводят Рой до перехвата (AUD-20)', () => {
  it('без цепочки ретрансляторов опыт боёв у дома игрока до улья не доходит', () => {
    // Волна у дома игрока бьётся вне сети: её малый ретранслятор до поста на `ridge` не
    // достаёт. Пока ИИ Роя сам не дотянул посты до `drift`, опыт остаётся на волнах — улей
    // не знает ничего. Дотянул — и опыт пошёл: сеть и есть канал обучения.
    const run = runMc01('weak', 120, false);
    const early = run.hits.filter((h) => run.chainAt === undefined || h.hour < run.chainAt);
    expect(early.length).toBeGreaterThan(0);
    expect(run.hiveBeforeChain).toBe(0);
    if (run.chainAt === undefined) {
      expect(run.state.swarmNet?.holders['planet:hive']?.known ?? []).toEqual([]);
      expect(run.started).toBeUndefined();
    } else {
      expect(run.started === undefined || run.started.hour >= run.chainAt).toBe(true);
    }
  });
  afterEach(disarmRun);

  it('бот забега сам открывает проект покрова, и он дорастает', () => {
    const run = runMc01('weak', 120);
    // Сигнал набран честно — ударами, а не подложенной памятью.
    expect(run.hits.length).toBeGreaterThanOrEqual(3);
    expect(run.started?.moduleId).toBe(VEIL);
    expect(run.started!.hour).toBeGreaterThanOrEqual(run.hits[2]!.hour);
    expect(run.done).toBeDefined();
    expect(run.done!.touched).toBeGreaterThan(0);
    expect(run.state.swarmRecipes?.[VEIL]).toBeGreaterThanOrEqual(1);
  });

  it('после проявления удар по матке встречает перехват, которого раньше не было', () => {
    const run = runMc01('weak', 120);
    expect(run.done).toBeDefined();
    const doneAt = run.done!.hour;
    const before = run.repelled.filter((r) => r.hour < run.started!.hour);
    const after = run.repelled.filter((r) => r.hour > doneAt);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    // До адаптации цель огрызается только долей пушек (5%) и не сбивает никого; покров
    // добавляет полный перехват — удар теперь стоит машин.
    const maxBefore = Math.max(...before.map((r) => r.damage));
    const maxAfter = Math.max(...after.map((r) => r.damage));
    expect(maxAfter).toBeGreaterThan(maxBefore * 5);
    expect(before.every((r) => r.downed === 0)).toBe(true);
    expect(after.some((r) => r.downed > 0)).toBe(true);
  });
});
