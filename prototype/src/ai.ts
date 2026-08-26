/**
 * Server-side seat AIs (REFP-26) — which AI (if any) plays a seat this tick
 * (`seatAiDecision`, SES-2.2: Steward delegation ⊳ substitute-after-grace ⊳ none)
 * and the full expansion bot / delegated-posture driver (`aiOrders`). Extracted
 * from `game.ts` as a pure move. Pure builders: both hosts (solo frame loop /
 * netserver driver) apply the returned actions through the kernel. `game.ts`
 * re-exports for main.ts / netserver.ts / tests (until REFP-28).
 */
import {
  BASE_RESEARCH_SLOTS,
  getStance,
  technologyLock,
  type GameState,
  type Action,
  type StewardPosture,
  type Planet,
  type Fleet,
} from '../../packages/shared-core/src/index';
import { provinceScore } from '../../packages/shared-core/src/state/sectorKind';
import {
  moveFleet,
  launchFleet,
  buildBuilding,
  upgradeBuilding,
  buildUnit,
  declareWar,
  canTraverse,
  marketList,
  mergeFleet,
  loadArmy,
  unloadArmy,
  researchTech,
  assaultFleet,
} from './actions';
import { netIncome } from './economy';
import { SECTOR_TYPES } from './map';
import { data } from './prototypeData';
import type { MarketSide } from '../../packages/shared-core/src/index';
import { stewardGuardOrders } from './stewardGuard';

/** The two server-side AIs that can play a seat, kept explicitly DISTINCT
 *  (SES-2.2). `steward` — «Хранитель»: the player's OWN autopilot, a defensive
 *  posture they turned on to cover their sleep; it runs on their chosen posture
 *  even while they are connected-but-idle, and its live delegation OUTRANKS the
 *  abandon grace. `substitute` — «заместитель»: the full expansion bot that takes
 *  over an ABANDONED chair, only after the player has been gone past the
 *  real-time grace window, and it is reclaimed the instant they return. `none` —
 *  no AI drives the seat this tick (a present player commands it, or an absent
 *  one is still inside their reconnect grace). */
export type SeatAiKind = 'steward' | 'substitute' | 'none';

/**
 * ЧЕЙ это бот — игровой или лабораторный (AI-BAL-1.1).
 *
 * `basic` — тот бот, которого встречает ЖИВОЙ игрок: соло-режим и прото-хост зовут
 * `aiOrders` без профиля, то есть всегда здесь. Он намеренно остаётся простым — игрок
 * изучает мир, ищет баги и щупает механики против предсказуемого соперника, а не против
 * оптимизатора.
 *
 * `test` — бот балансных ПРОГОНОВ (`selfplay.mjs`, `econplaytest.mjs`). Ему включены
 * эвристики, которые нужны, чтобы измерение вообще что-то мерило: без них батч показывает
 * не баланс игры, а гонку двух построек (базовая линия — блок AI-BAL в `backlog.md`).
 *
 * Почему это ПАРАМЕТР ФУНКЦИИ, а не поле состояния, не настройка матча и не сообщение
 * протокола: так у игрока физически нет способа получить тест-бота ни себе в союзники,
 * ни в противники. Нечего выставить в лобби, нечего прислать в `action`-конверте, нечего
 * подделать в снапшоте — профиль не пересекает границу процесса и не попадает ни в
 * `GameState`, ни в сеть, ни в сохранение. Тест-ботов не существует в игре; они существуют
 * только внутри headless-харнеса, который их и создаёт.
 *
 * Сторож `aiProfile.test.ts` держит это структурно: он читает исходники и роняет гейт,
 * если `'test'` просочился в игровой путь.
 */
export type AiProfile = 'basic' | 'test';

/**
 * Наземный ростер В ФИКСИРОВАННОМ порядке «тяжёлое → дешёвое» (AI-BAL-3).
 *
 * Порядок здесь — не вкус, а требование инварианта #1: перебор `data.units` дал бы
 * порядок, зависящий от раскладки объекта, и один сид разыгрался бы по-разному.
 * Тест-бот берёт ПЕРВОЕ, что по карману, поэтому список заодно задаёт приоритет:
 * ранняя казна тянет только ополчение, поздняя — танки.
 */
const GROUND_ROSTER = ['tank', 'special_forces', 'heavy_infantry', 'militia'] as const;

/** То же для ОБОРОНЫ: гарнизон держит тот, у кого выше `defense`, а не `attack` —
 *  тяжёлая пехота (20) стоит насмерть лучше танка (14) и втрое дешевле. */
const GROUND_DEFENDERS = ['heavy_infantry', 'tank', 'militia'] as const;

/** Сколько наземных юнитов тест-бот держит дома: гарнизон + запас на десант. */
const GROUND_STOCK = 8;
/** Столько войск НЕ грузится в трюм: иначе дом остаётся пустым и берётся прилётом. */
const HOME_GUARD = 3;
/** Верхний предел десантных корпусов — трюм 8 против 5 у крейсера, больше не нужно. */
const DROPSHIP_CAP = 2;
/** Сколько артиллерийских корпусов держит тест-бот (AI-BAL-4): дальний огонь — не
 *  замена флоту, а добавка к нему; стеклянная пушка гибнет от первого же сближения. */
const SIEGE_CAP = 2;
/** Уровень завода, на котором открывается ангар (`enablesSquadronConstruction`). */
const SQUADRON_FACTORY_LEVEL = 2;
/** Предел ударных крыльев — картонные, дорогие по микроэлектронике, конкурируют с
 *  крейсерами за тот же дефицитный ресурс. */
const SQUADRON_CAP = 3;
/** Запас казны сверх цены заказа (мера та же, что у построек бота). */
const ORDER_RESERVE: Record<string, number> = { metal: 60, credits: 60 };

/**
 * ДЕТЕРМИНИРОВАННЫЙ ШУМ РЕШЕНИЯ (AI-BAL-5) — [0, 1), только для тест-профиля.
 *
 * Зачем. Прогоны баланса не давали статистики: семьи сидов `base` и `alt` совпадали до
 * последней цифры, то есть 300 матчей были 4 конфигурациями (слот × фракция) по 75
 * повторов. Разброс терялся НЕ в карте и не в ядре, а здесь: `aiOrders` выбирала строго
 * ближайшую цель, держала фиксированные пороги и обходила миры в порядке раскладки
 * объекта — при одинаковых стартах два матча просто не могли разойтись.
 *
 * Откуда берётся энтропия. Из `state.rng` — того самого потока ядра, который seedRng
 * развёл по сидам ЕЩЁ НА СТАРТЕ матча и который дальше движется от каждого броска в бою.
 * Мы его только ЧИТАЕМ: мутировать поток снаружи ядра нельзя (это сдвинуло бы бои и
 * сломало реплей), поэтому четыре слова состояния смешиваются в отдельный хеш вместе с
 * часом мира, местом и «солью» конкретного решения.
 *
 * Почему это не ломает инвариант #1. Здесь нет ни `Math.random`, ни `Date.now`: результат
 * — чистая функция от (сид матча, история бросков, время, место, соль), то есть один сид
 * по-прежнему разыгрывается байт-в-байт одинаково. Арифметика та же, что в `rng.ts`
 * (`Math.imul` + сдвиги), — bit-exact на любом движке.
 *
 * Это НЕ «случайная игра»: бот остаётся жадным и предсказуемым, шум лишь разводит
 * равноценные ветки — вторая по близости цель вместо первой, порог войны в коридоре
 * ±20%, точка входа в обход миров. Игрового бота не касается вовсе (профиль `test`).
 */
function decisionNoise(state: GameState, ai: string, salt: string): number {
  const r = state.rng;
  let h = (r.a ^ r.b ^ r.c ^ r.d) >>> 0;
  h = Math.imul(h ^ Math.floor(state.time / 3_600_000), 2246822507) >>> 0;
  const key = `${ai}|${salt}`;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

/**
 * Порядок обхода миров, ПОВЁРНУТЫЙ на seeded смещение (AI-BAL-5, точка разброса №3).
 *
 * Блоки развития выписывают одну стройку за тик и выходят по `break`, поэтому решает не
 * весь список, а его ПЕРВЫЙ подходящий элемент — а он до сих пор определялся раскладкой
 * объекта `state.planets`, одинаковой во всех матчах. Ротация сохраняет относительный
 * порядок (это не перемешивание: жадность бота не страдает), но сдвигает точку входа,
 * так что развиваться первым начинает разный мир. Игровой профиль обходит как раньше.
 */
function worldsInOrder(state: GameState, ai: string, salt: string, profile: AiProfile): Planet[] {
  const all = Object.values(state.planets);
  if (profile !== 'test') return all;
  // Ротируются именно СВОИ миры, а не весь список: чужих и нейтральных на карте вчетверо
  // больше, и они лежат вперемешку, так что поворот всего массива почти всегда возвращал
  // к тем же двум-трём своим в его начале — точка входа не менялась. Прочие миры едут
  // следом нетронутым хвостом: вызывающие всё равно фильтруют по владельцу.
  const own: Planet[] = [];
  const rest: Planet[] = [];
  for (const p of all) (p.owner === ai ? own : rest).push(p);
  if (own.length < 2) return all;
  const shift = Math.floor(decisionNoise(state, ai, `order:${salt}`) * own.length) % own.length;
  return own.slice(shift).concat(own.slice(0, shift), rest);
}

/** Стоит ли на мире ЖИВОЕ здание, открывающее наземное производство (казарма/завод).
 *  Зеркало ядерного `hasGroundFacility` (`construction.ts`) — того самого гейта, который
 *  отбивает `unit.build` кодом `E_NO_GROUND_FACILITY`. */
function hasGroundYard(p: Planet): boolean {
  return p.buildings.some(
    (b) => b.hp > 0 && data.buildings[b.type]?.enablesGroundConstruction === true,
  );
}

/** Сколько НАЗЕМНЫХ юнитов стоит в гарнизоне мира (корабли в гарнизоне не в счёт). */
function groundCount(p: Planet): number {
  return p.garrison.reduce((n, s) => n + (data.units[s.unit]?.domain === 'ground' ? s.count : 0), 0);
}

/** Свободный трюм флота: Σ cargoCapacity кораблей − Σ cargoSize уже погруженного
 *  десанта. Та же формула, что у ядра (`army.ts`), иначе погрузка сыпала бы
 *  `E_NO_CAPACITY`. */
function liftFree(f: Fleet): number {
  const cap = f.units.reduce(
    (n, s) => n + (data.units[s.unit]?.stats.cargoCapacity ?? 0) * s.count,
    0,
  );
  const used = (f.landing ?? []).reduce(
    (n, s) => n + (data.units[s.unit]?.stats.cargoSize ?? 1) * s.count,
    0,
  );
  return cap - used;
}

/** What drives a seat this tick + the posture to hand `aiOrders`. */
export interface SeatAiDecision {
  kind: SeatAiKind;
  posture: StewardPosture | 'expand' | null; // null ⇔ kind === 'none'
}

/** Decide which server AI (if any) plays ONE seat this tick — SES-2.2. Pure:
 *  reads only the three facts the host tracks, no time source of its own.
 *  `hasHuman` — a live peer holds the chair; `posture` — the seat's active
 *  Steward delegation (`stewardActive`), null if none; `graceExpired` — the
 *  player has been absent PAST the real-time abandon window (wall-clock, the host
 *  compares `Date.now()`; always true for a chair that never opened a window).
 *  The precedence encodes the owner's intent: a delegation they set beats the
 *  automatic takeover, and a present human beats the idle bot. */
export function seatAiDecision(
  hasHuman: boolean,
  posture: StewardPosture | null,
  graceExpired: boolean,
): SeatAiDecision {
  // A live Steward delegation is the player's OWN autopilot: it plays regardless
  // of connection and never waits on the abandon grace (they asked for it).
  if (posture) return { kind: 'steward', posture };
  // No delegation → a present human commands their own chair.
  if (hasHuman) return { kind: 'none', posture: null };
  // Empty chair: wait out the grace (a drop / restart blip / a few days away)
  // before the substitute bot seizes it — reclaimed the moment they return.
  if (!graceExpired) return { kind: 'none', posture: null };
  return { kind: 'substitute', posture: 'expand' };
}

/** One decision tick's orders for an AI-driven seat, evaluated against `state`.
 *  Read-only: it builds and returns the actions; the caller applies them — the
 *  client to its local sim, the server through the authoritative room. Drives
 *  empty seats the same way in solo and multiplayer (a seat with no human). */
export function aiOrders(
  state: GameState,
  ai: string,
  posture: StewardPosture | 'expand' = 'expand',
  profile: AiProfile = 'basic',
): Action[] {
  const out: Action[] = [];
  if (!state.players[ai]) return out; // seat not in play / eliminated
  // The defensive family: both Steward postures HOLD (no expansion, no war
  // declarations); «Активная оборона» merely adds the counterstrike/fire-watch
  // inside the guard-duty tick below.
  const defensive = posture === 'defend' || posture === 'active_defend';
  // Steward guard duty (ST-3.2/3.3): a delegated defensive seat watches its worlds,
  // evacuates a wing the forecast says it would lose ≥ STEWARD_LOSS_LIMIT of, and —
  // under «Активная оборона» — counterstrikes what it beats cheaply on own soil.
  if (defensive) out.push(...stewardGuardOrders(state, ai, posture as StewardPosture));
  const isShipUnit = (u: string): boolean => !data.units[u]?.traits.includes('ground');
  const capturable = (p: Planet): boolean => SECTOR_TYPES[p.kind ?? '']?.capturable ?? false;
  const d = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y);
  // Send each idle AI fleet toward the nearest capturable world it can reach — only
  // neutral worlds or territory of someone it's at WAR with (peace = off-limits).
  // Steward «Оборона» (a delegated human seat, posture 'defend') HOLDS: it skips this
  // offensive sweep entirely and only builds / reinforces / trades below — repelling an
  // attacker is automatic in combat. "Autopilot keeps you alive; active play wins."
  // Named `warFooting` (not `atWar`) so the module-level pair helper stays visible.
  const warFooting = Object.keys(state.players).some(
    (pid) =>
      pid !== ai && state.players[pid]?.status === 'active' && getStance(state, ai, pid) === 'war',
  );
  // The home base (build/launch anchor, and the rally point ships pool at during war).
  //
  // ЯКОРЬ — ВЕРФЬ, а не «первый застроенный мир» (баг, найденный при AI-BAL-3, чинится
  // ОБОИМ профилям). Стоило боту поставить шахту на призовом мире — и `find` начинал
  // возвращать ЕГО: «дом» переезжал на мир без космопорта. Дальше каждый заказ корабля
  // отбивался `E_NO_SHIPYARD` (в пробном матче — 102 отказа за матч), экономическая
  // цепочка строилась не дома, а на призовом мире, и флот переставал пополняться вовсе.
  // Обе прежние ветки оставлены запасными: у мира без верфи якорь тот же, что и был.
  const base =
    Object.values(state.planets).find(
      (p) =>
        p.owner === ai &&
        p.buildings.some(
          (b) => b.hp > 0 && data.buildings[b.type]?.enablesShipConstruction === true,
        ),
    ) ??
    Object.values(state.planets).find((p) => p.owner === ai && p.buildings.length > 0) ??
    Object.values(state.planets).find((p) => p.owner === ai);
  const shipCount = (f: Fleet): number =>
    f.units.reduce((n, s) => n + (isShipUnit(s.unit) ? s.count : 0), 0);
  const expandFleets: Fleet[] = defensive ? [] : Object.values(state.fleets);
  // Consolidate BEFORE moving (self-play M4): two idle fleets sharing a location fuse
  // into one — without this, battle remnants and rally leftovers accumulate into a
  // hundreds-strong swarm of one-ship fleets that grinds the whole sim (and feeds
  // enemy AA one hull at a time). The merged fleet sorties on the next tick.
  const skipMove = new Set<string>();
  {
    const byLoc = new Map<string, Fleet[]>();
    for (const f of expandFleets) {
      if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
      const group = byLoc.get(f.location);
      if (group) group.push(f);
      else byLoc.set(f.location, [f]);
    }
    for (const group of byLoc.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => shipCount(b) - shipCount(a));
      for (let k = 1; k < group.length; k++) {
        out.push(mergeFleet(ai, group[k]!.id, group[0]!.id));
        skipMove.add(group[k]!.id);
      }
      skipMove.add(group[0]!.id); // it grows this tick, sorties the next
    }
  }
  for (const f of expandFleets) {
    if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
    if (skipMove.has(f.id)) continue;
    // ═══ ТЕСТ-БОТ (AI-BAL-3): десант и штурм ═══
    // Игровой бот не делает НИ ТОГО, НИ ДРУГОГО, и вот почему вторая фаза захвата
    // (орбита → высадка, GDD §7.4) в измерении баланса не участвовала вовсе:
    //   • приказ `fleet.assault` бот не отдавал НИКОГДА. В сети штурм ведёт драйвер
    //     `serverAutoAssaultActions`, а тот ходит только по флотам, которым ИГРОК
    //     включил авто-штурм (`order.auto`) — у бота такого флага нет ни одного;
    //   • трюм он грузил только на войне и только двумя ополченцами.
    // Итог в батче: гарнизонный мир для бота просто НЕПРОХОДИМ — флот прилетает,
    // `captureOnArrival` пропускает защищённый мир, и флот стоит на орбите до конца
    // матча. Игровой профиль не тронут: это лаборатория.
    if (profile === 'test' && base) {
      const here0 = state.planets[f.location];
      // (а) Погрузка ДОМА и в мирное время: пустой трюм у стены гарнизона означает,
      //     что флот долетит и встанет. Дома остаётся `HOME_GUARD` — иначе бот
      //     вывозит собственную оборону и его столицу берут прилётом.
      if (here0 && here0.id === base.id) {
        let free = liftFree(f);
        let spare = groundCount(here0) - HOME_GUARD;
        for (const u of GROUND_ROSTER) {
          if (free <= 0 || spare <= 0) break;
          const size = data.units[u]?.stats.cargoSize ?? 1;
          const have = here0.garrison.reduce((n, st) => n + (st.unit === u ? st.count : 0), 0);
          const take = Math.min(have, spare, Math.floor(free / size));
          if (take > 0) {
            out.push(loadArmy(ai, f.id, u, take));
            free -= take * size;
            spare -= take;
          }
        }
      }
      // (а2) ГАРНИЗОН НА ЗАНЯТОМ МИРЕ (AI-BAL-2). Мир без войск берётся ПРИЛЁТОМ —
      //      `captureOnArrival` не смотрит ни на здания, ни на их оборонный бонус, только
      //      на `garrison.some(count > 0)`. Отсюда карусель базовой линии: 113 захватов
      //      прилётом за матч, миры перекидываются без единого выстрела. Флот, стоящий на
      //      СВОЁМ пустом мире, оставляет одного бойца — дальше этот мир нужно штурмовать.
      //      По одному: остальной десант нужен самому флоту, иначе он разоружится в дороге.
      if (
        here0 &&
        here0.owner === ai &&
        here0.id !== base.id &&
        groundCount(here0) === 0 &&
        capturable(here0)
      ) {
        const carried = (f.landing ?? []).find((st) => st.count > 0);
        if (carried) out.push(unloadArmy(ai, f.id, carried.unit, 1));
      }
      // (б) Штурм с орбиты. Правила штурма называет ЯДРО (`assaultPlanet`), здесь
      //     только повод не сыпать заведомо отбиваемым приказом: чужой захватываемый
      //     мир, война/нейтралитет, живой гарнизон и десант в трюме.
      if (
        here0 &&
        f.orbit === 'near' &&
        here0.owner !== ai &&
        capturable(here0) &&
        canTraverse(state, ai, here0.owner) &&
        here0.garrison.some((st) => st.count > 0) &&
        (f.landing ?? []).some((st) => st.count > 0)
      ) {
        out.push(assaultFleet(ai, f.id));
        continue; // берём ЭТОТ мир, а не улетаем к следующему
      }
    }
    // Strike groups, not dribbles (self-play M4): auto-rally pools each new ship into
    // the IDLE rally fleet at its build world — but only while one is parked there.
    // Sending every single-ship fleet out at once therefore orphaned the rally point,
    // spawned a fresh one-ship fleet per build (hundreds of fleets, the sim ground to
    // a halt) and fed hulls into enemy AA one at a time. At war, ships HOLD at the
    // home rally point until a strike group has formed; peacetime keeps the old
    // race-to-claim behaviour (speed is everything, there is nothing to fight).
    if (warFooting && f.location === base?.id) {
      if (shipCount(f) < 3) continue;
      // Lift a landing party before the sortie: only ground troops can take a
      // garrisoned world (two-phase capture), so a strike group without a landing
      // can raid provinces but never resolve the war. Load, then move — same tick.
      const militia = base.garrison.find((s) => s.unit === 'militia' && s.count > 0);
      const hasLanding = (f.landing ?? []).some((s) => s.count > 0);
      if (!hasLanding && militia) {
        out.push(loadArmy(ai, f.id, 'militia', Math.min(2, militia.count)));
      }
    }
    const here = state.planets[f.location];
    if (!here) continue;
    let best: Planet | null = null;
    let bestD = Infinity;
    let second: Planet | null = null;
    let secondD = Infinity;
    for (const p of Object.values(state.planets)) {
      if (p.owner === ai || !capturable(p)) continue;
      if (!canTraverse(state, ai, p.owner)) continue; // a peace-locked target — leave it be
      const dd = d(here.position, p.position);
      if (dd < bestD) {
        secondD = bestD;
        second = best;
        bestD = dd;
        best = p;
      } else if (dd < secondD) {
        secondD = dd;
        second = p;
      }
    }
    // AI-BAL-5, точка разброса №1: ТЕСТ-бот иногда идёт ко ВТОРОЙ по близости цели.
    // Строгий выбор ближайшей — главная причина, по которой два матча с разных сидов
    // разыгрывались одинаково: пути флотов совпадали с первого тика. Вторая цель берётся
    // только если она сопоставима по дальности (не дальше 2×), то есть бот остаётся
    // жадным — расходятся лишь РАВНОЦЕННЫЕ ветки, а не качество игры.
    if (
      profile === 'test' &&
      second &&
      secondD <= bestD * 2 &&
      decisionNoise(state, ai, `target:${f.id}`) < 0.35
    ) {
      best = second;
    }
    if (best) out.push(moveFleet(ai, f.id, best.id));
  }
  // War when the race is being LOST (self-play M4 finding): a passive bot loses the
  // score race to whoever expands faster — every bot-vs-bot match ended as a 2-day
  // race with zero battles, and the military (and combat factions) never played. So
  // a bot falling a planet's worth (≥ 50) behind the score leader — or merely behind
  // once no capturable neutral is left — declares war on that leader; the expansion
  // loop above then targets war territory (traversable/capturable) and contested
  // provinces swing back. A bot that IS ahead stays quiet — it wins by holding.
  // Declared only from a clean 'peace' stance: pacts/alliances are never betrayed,
  // and favour-driven war (botDiplomacyModule) keeps working on top unchanged.
  if (!defensive) {
    const scoreOf = (who: string): number =>
      Object.values(state.planets).reduce(
        (s, p) => (p.owner === who ? s + provinceScore(data, p) : s),
        0,
      );
    const mine = scoreOf(ai);
    let leader: string | null = null;
    let leaderScore = -1;
    for (const pid of Object.keys(state.players)) {
      if (pid === ai || state.players[pid]?.status !== 'active') continue;
      const sc = scoreOf(pid);
      if (sc > leaderScore) {
        leaderScore = sc;
        leader = pid;
      }
    }
    const neutralLeft = Object.values(state.planets).some((p) => p.owner === null && capturable(p));
    // AI-BAL-5, точка разброса №2: порог войны у ТЕСТ-бота плавает в коридоре ±20%
    // (50 → 40..60 очков отставания). Фиксированные 50 означали, что война объявляется
    // в один и тот же игровой час при одинаковых стартах — а момент объявления решает,
    // кто успел развернуться. Коридор узкий: бот по-прежнему воюет, когда проигрывает
    // гонку, просто не секунда-в-секунду с самим собой из другого матча.
    const warGap = profile === 'test' ? 50 * (0.8 + 0.4 * decisionNoise(state, ai, 'war')) : 50;
    const losingRace = leaderScore - mine >= warGap || (!neutralLeft && leaderScore >= mine);
    if (leader && losingRace && getStance(state, ai, leader) === 'peace') {
      out.push(declareWar(ai, leader));
    }
  }
  // Build + launch from this AI's home base (its first developed owned world).
  const pl = state.players[ai];
  if (base && pl) {
    // Keep the lights on first: a bot whose energy/food NET flow is negative (or already
    // in arrears) raises a plant/farm before anything else — brownouts halve its economy.
    const flow = netIncome(state, ai);
    const has = (b: string): boolean =>
      Object.values(state.planets).some(
        (p) => p.owner === ai && p.buildings.some((x) => x.type === b),
      );
    for (const [need, b] of [
      ['energy', 'power_plant'],
      ['food', 'farm'],
    ] as const) {
      if ((flow[need] ?? 0) >= 0 && !(pl.arrears ?? []).includes(need)) continue;
      if (has(b)) continue;
      const cost = data.buildings[b]?.cost ?? {};
      if (Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60)) {
        out.push(buildBuilding(ai, base.id, b));
      }
    }
    // Economy chain (self-play M4: mine/refinery/tax office were DEAD content for the
    // bot — it bought all its metal on the market): raise the first missing credit
    // engine at the home base (refinery → tax office), and put a metal mine on each
    // captured PRIZE world — one link at a time, only when comfortably affordable,
    // and never over the same build already queued (no reject spam).
    const pendingBuild = (planetId: string, b: string): boolean =>
      state.scheduled.some((e) => {
        if (e.type !== 'construction.complete') return false;
        const q = e.payload as { kind?: string; planetId?: string; building?: string };
        return q.kind === 'building' && q.planetId === planetId && q.building === b;
      });
    const affordable = (b: string): boolean => {
      const cost = data.buildings[b]?.cost ?? {};
      return Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60);
    };
    // ECON-7: fabricator joins the chain — microelectronics gates warships now
    // (cruiser/siege cost micro), so a bot without a fab eventually can't build a
    // fleet. Built once the credit/tax engine is up; keeps micro produced AND spent.
    for (const b of ['refinery', 'tax_office', 'fabricator'] as const) {
      if (has(b)) continue;
      if (affordable(b) && !pendingBuild(base.id, b)) out.push(buildBuilding(ai, base.id, b));
      break; // one link at a time — wait out the current one either way
    }
    for (const p of worldsInOrder(state, ai, 'mine', profile)) {
      if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
      if (p.buildings.some((x) => x.type === 'mine') || pendingBuild(p.id, 'mine')) continue;
      if (!affordable('mine')) break;
      out.push(buildBuilding(ai, p.id, 'mine'));
      break; // spread the economy one world per tick
    }
    // ТЕСТ-БОТ ТОЛЬКО (AI-BAL-1.1): технологии исследует лабораторный профиль, игровой —
    // нет. Живому игроку достаётся прежний простой соперник; прогон баланса получает
    // соперника, у которого работает ветка эффектов.
    //
    // Технологии: игровой бот не исследует НИ ОДНОЙ из 25 (self-play: 0 за 300 матчей),
    // поэтому вся ветка эффектов — бонусы к добыче, скорости и урону, гейты контента —
    // не участвовала в измерении баланса вовсе. Правило намеренно минимальное: бот не
    // «строит билд», он просто не оставляет исследовательские слоты пустыми.
    //
    // Что можно взять, решает САМО ЯДРО — `technologyLock` (prerequisites / day-gate /
    // conditions), а не копия правил здесь: разъедься копия с модулем, бот начал бы
    // спамить отказами, и первым признаком была бы не ошибка, а тихо изменившийся баланс.
    // Слоты считаем по базовой константе, а не по хуку `research.slots` (хук живёт внутри
    // ядра и снаружи не вызывается): с учёным слотов может быть больше, тогда бот
    // недоиспользует лишний — это честный недобор, а не отказ.
    const techState = pl.technologies;
    const activeTech = techState?.active ?? [];
    const doneTech = techState?.completed ?? [];
    if (profile === 'test' && activeTech.length < BASE_RESEARCH_SLOTS) {
      const affordableTech = (cost: Record<string, number>): boolean =>
        Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60);
      const candidates = Object.keys(data.technologies)
        .filter((id) => {
          const def = data.technologies[id];
          if (!def) return false;
          if (doneTech.includes(id) || activeTech.some((a) => a.technology === id)) return false;
          if (technologyLock(def, state, ai, data) !== null) return false;
          return affordableTech(def.cost ?? {});
        })
        // Дешёвое и быстрое вперёд — это не «оптимальный порядок», а ДЕТЕРМИНИРОВАННЫЙ:
        // id последним ключом сортировки, чтобы порядок не зависел от перебора объекта
        // (иначе один и тот же сид разыгрался бы по-разному, инвариант #1).
        .sort((a, b) => {
          const da = data.technologies[a]!;
          const db = data.technologies[b]!;
          const sum = (c: Record<string, number> = {}): number =>
            Object.values(c).reduce((n, v) => n + v, 0);
          return (
            sum(da.cost) - sum(db.cost) ||
            (da.researchTimeHours ?? 0) - (db.researchTimeHours ?? 0) ||
            (a < b ? -1 : a > b ? 1 : 0)
          );
        });
      if (candidates[0]) out.push(researchTech(ai, candidates[0]));
    }
    // Ship production is CAPPED by the fleet count (self-play M4: endless building
    // fed an ever-growing swarm — hundreds of fleets by mid-match). Enough fleets
    // out ⇒ the metal flows to economy/garrisons instead.
    const aiFleets = Object.values(state.fleets).filter((f) => f.owner === ai).length;
    if (
      aiFleets < (warFooting ? 8 : 4) &&
      (pl.resources.metal ?? 0) > 220 &&
      (pl.resources.credits ?? 0) > 120 &&
      (pl.resources.microelectronics ?? 0) >= 3 // ECON-7: warships need the hi-tech good
    ) {
      out.push(buildUnit(ai, base.id, 'cruiser', 1));
    }
    // Wartime posture (self-play M4: wars were free walk-in raids — the leader had no
    // garrisons, so whoever attacked always came back and won): at war the bot
    // (a) garrisons its undefended PRIZE worlds with militia — a garrisoned planet
    // can't be walk-in captured, it takes a ground assault; the 10-point provinces
    // stay an open raid zone by design; (b) adds fast scouts to the build mix
    // (capture runners for that raid zone); (c) fields more fleets — and a launched
    // fleet lifts home-built militia aboard as landing troops (fleet.launch), which
    // is exactly what lets it assault a garrisoned world back.
    if (warFooting) {
      let garrisonOrders = 0;
      for (const p of worldsInOrder(state, ai, 'garrison', profile)) {
        if (garrisonOrders >= 2 || (pl.resources.metal ?? 0) < 90) break;
        if (p.owner !== ai || p.kind !== 'planet') continue;
        if (p.garrison.some((s) => s.count > 0)) continue;
        // Без казармы ядро отобьёт заказ (`E_NO_GROUND_FACILITY`) — раньше этот блок
        // сыпал такими отказами весь матч (60 за пробный матч). Поведение не меняется:
        // отсеиваются ровно те приказы, которые всё равно ничего не делали.
        if (!hasGroundYard(p)) continue;
        out.push(buildUnit(ai, p.id, 'militia', 2));
        garrisonOrders += 1;
      }
      // A landing stock at home: strike groups lift militia on sortie (above), so
      // the base keeps a few spare beyond its seeded defenders.
      const baseMilitia = base.garrison
        .filter((s) => s.unit === 'militia')
        .reduce((n, s) => n + s.count, 0);
      if (baseMilitia < 4 && (pl.resources.metal ?? 0) > 120 && hasGroundYard(base)) {
        out.push(buildUnit(ai, base.id, 'militia', 2));
      }
      if (aiFleets < 8 && (pl.resources.metal ?? 0) > 140) {
        out.push(buildUnit(ai, base.id, 'scout', 1));
      }
    }
    // ═══ ТЕСТ-БОТ (AI-BAL-3): наземная кампания ═══
    // Диагноз, ради которого этот блок и появился: в батче на 300 матчей ВСЕ четыре
    // наземных юнита показывались «мёртвым контентом» — и не потому, что бот их не
    // заказывал (на войне он заказывал ополчение), а потому, что каждый такой заказ
    // ядро отбивало кодом `E_NO_GROUND_FACILITY`: наземное производство открывает
    // казарма (`enablesGroundConstruction`), а бот не строил её никогда — стартовый
    // мир получает только космопорт (`matchSetup.ts`). Отказ тихий: `applyAction`
    // возвращает `{ ok: false }`, харнес его пропускает, и в отчёте это выглядело как
    // «бот не хочет пехоту», а не как «пехота ему запрещена».
    //
    // Порядок здесь и есть цепочка захвата: казарма → войска → гарнизон на призовых
    // мирах (он-то и превращает «прилетел и забрал» в ШТУРМ) → десантный корпус.
    if (profile === 'test') {
      const pendingUpgrade = (planetId: string, building: string): boolean =>
        state.scheduled.some((e) => {
          if (e.type !== 'construction.complete') return false;
          const q = e.payload as { kind?: string; planetId?: string; building?: string };
          return q.kind === 'upgrade' && q.planetId === planetId && q.building === building;
        });
      const pendingUnit = (planetId: string, unit: string): boolean =>
        state.scheduled.some((e) => {
          if (e.type !== 'construction.complete') return false;
          const q = e.payload as { kind?: string; planetId?: string; unit?: string };
          return q.kind === 'unit' && q.planetId === planetId && q.unit === unit;
        });
      const affordableUnit = (unit: string, count: number): boolean => {
        const cost = data.units[unit]?.cost ?? {};
        return Object.keys(cost).every(
          (r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) * count + (ORDER_RESERVE[r] ?? 0),
        );
      };
      // 1. Казарма дома — ворота ко ВСЕМУ наземному ростеру.
      if (!hasGroundYard(base)) {
        if (affordable('barracks') && !pendingBuild(base.id, 'barracks')) {
          out.push(buildBuilding(ai, base.id, 'barracks'));
        }
      } else {
        // 2. Запас войск дома: гарнизон столицы + то, что увезёт десант. Берётся самое
        //    тяжёлое по карману, поэтому ростер отыгрывается весь: ранняя казна тянет
        //    ополчение, поздняя — спецназ и танки.
        const pendingHome = GROUND_ROSTER.reduce(
          (n, u) => n + (pendingUnit(base.id, u) ? 2 : 0),
          0,
        );
        if (groundCount(base) + pendingHome < GROUND_STOCK) {
          // Пока дома нет даже домашней стражи — заказывается ОБОРОНИТЕЛЬНЫЙ род войск;
          // всё сверх неё уедет в трюме, поэтому там нужен ударный.
          const list = groundCount(base) < HOME_GUARD ? GROUND_DEFENDERS : GROUND_ROSTER;
          const pick = list.find((u) => affordableUnit(u, 2));
          if (pick) out.push(buildUnit(ai, base.id, pick, 2));
        }
      }
      // 3. Призовые миры: сперва казарма, потом ополчение в пустой гарнизон. Мир с
      //    гарнизоном нельзя забрать прилётом — за него придётся высаживаться, и
      //    ровно этого измерению не хватало.
      for (const p of worldsInOrder(state, ai, 'barracks', profile)) {
        if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
        if (!hasGroundYard(p)) {
          if (pendingBuild(p.id, 'barracks')) continue;
          if (!affordable('barracks')) break;
          out.push(buildBuilding(ai, p.id, 'barracks'));
          break; // одна стройка за тик — как и с шахтой
        }
        if (groundCount(p) > 0 || pendingUnit(p.id, 'militia')) continue;
        if (!affordableUnit('militia', 2)) break;
        out.push(buildUnit(ai, p.id, 'militia', 2));
        break;
      }
      // 5. ОБОРОНА (AI-BAL-2): форт → госпиталь → орбитальная ПВО. Порядок — по тому,
      //    что каждое здание делает для УДЕРЖАНИЯ: форт даёт гарнизону +30% обороны
      //    (`defenseBonus` через хук `combat.damage`), госпиталь его лечит между
      //    штурмами (`healRate`), ПВО бьёт флот на орбите (`aaDamage`). Плюс любое
      //    стоящее здание снимает 1% наземного урона (потолок 90%), поэтому застроенный
      //    мир дорог сам по себе. Только призовые миры: провинций вчетверо больше, и
      //    застраивать их — разорить казну на десятую долю территории.
      const DEFENSE_CHAIN = ['fort', 'hospital', 'orbital_aa'] as const;
      for (const p of warFooting ? worldsInOrder(state, ai, 'defense', profile) : []) {
        if (p.owner !== ai || p.kind !== 'planet') continue;
        const missing = DEFENSE_CHAIN.find(
          (b) => !p.buildings.some((x) => x.type === b) && !pendingBuild(p.id, b),
        );
        if (!missing) continue;
        if (!affordable(missing)) break;
        out.push(buildBuilding(ai, p.id, missing));
        break; // одна стройка за тик — как в экономической цепочке
      }
      // Сколько таких корпусов у места ВСЕГО: во флотах плюс ещё не поднятые в
      //    гарнизоне дома (авто-рандеву кладёт новый корабль именно туда).
      const shipsOwned = (unit: string): number =>
        Object.values(state.fleets).reduce(
          (n, fl) =>
            n + (fl.owner === ai ? fl.units.reduce((k, st) => k + (st.unit === unit ? st.count : 0), 0) : 0),
          0,
        ) + base.garrison.reduce((n, st) => n + (st.unit === unit ? st.count : 0), 0);
      // 4. Десантный корпус: трюм 8 против 5 у крейсера — без него ударная группа
      //    везёт горстку и штурм захлёбывается на первом же гарнизоне.
      if (
        shipsOwned('dropship') < DROPSHIP_CAP &&
        !pendingUnit(base.id, 'dropship') &&
        affordableUnit('dropship', 1)
      ) {
        out.push(buildUnit(ai, base.id, 'dropship', 1));
      }
      // ═══ 6. АРТИЛЛЕРИЯ И АВИАЦИЯ (AI-BAL-4) ═══
      // Артиллерия стреляет САМА: `artilleryModule` каждым пролётом времени заставляет
      // свободный стоящий флот с `artillery`-корпусом обстрелять ближайший враждебный
      // стоящий флот в радиусе `range` — без приказа, без ответного огня и без входа в
      // бой. То есть `siege` не требует от бота ни одной новой команды: достаточно его
      // ПОСТРОИТЬ, и целый пласт боя (дальний огонь) входит в измерение.
      if (
        warFooting &&
        shipsOwned('siege') < SIEGE_CAP &&
        !pendingUnit(base.id, 'siege') &&
        affordableUnit('siege', 1)
      ) {
        out.push(buildUnit(ai, base.id, 'siege', 1));
      }
      // Эскадрильи. Ворота — здание с `enablesSquadronConstruction`; у завода эта
      // способность появляется ВТОРЫМ уровнем, поэтому цепочка длинная: построить завод
      // → апгрейдить → строить крылья. Дальше эскадрилья дерётся как обычный ударный
      // корпус в составе флота (быстрая, больно бьёт, картонная — её счётчик орбитальная
      // ПВО). СВОБОДНОГО ВЫЛЕТА у неё пока нет ни у кого: `squadron.strike` требует
      // `fleet.homeBase`, а это поле в игре не выставляет ни один модуль (`fleet.split`
      // в том числе) — механика вылета не достроена, это отдельный кирпич, не задача бота.
      const factory = base.buildings.find((b) => b.type === 'factory' && b.hp > 0);
      if (!factory) {
        if (affordable('factory') && !pendingBuild(base.id, 'factory')) {
          out.push(buildBuilding(ai, base.id, 'factory'));
        }
      } else if (factory.level < SQUADRON_FACTORY_LEVEL) {
        if (affordable('factory') && !pendingUpgrade(base.id, 'factory')) {
          out.push(upgradeBuilding(ai, base.id, 'factory'));
        }
      } else if (
        shipsOwned('fighter_squadron') < SQUADRON_CAP &&
        !pendingUnit(base.id, 'fighter_squadron') &&
        affordableUnit('fighter_squadron', 1)
      ) {
        out.push(buildUnit(ai, base.id, 'fighter_squadron', 1));
      }
    }
    // (marine retired: the AI no longer cheap-builds a ground trooper. Its home keeps its
    //  seeded infantry garrison + orbital-AA building for defence; mobile ground via divisions.)
    const baseHasShip = base.garrison.some((st) => isShipUnit(st.unit));
    if (aiFleets < (warFooting ? 4 : 2) && baseHasShip) out.push(launchFleet(ai, base.id));
  }
  // Trade on the session market: a passive bot liquidates the surplus goods it never
  // uses (food/energy/microelectronics) into the credits it always needs, and — when
  // flush — bids for the metal it burns fastest. One open lot per resource so it doesn't
  // spam. Embargo needs no check here: the book is anonymous and market.take rejects a
  // soured player from filling the bot's lots (botEmbargoes), so the bot simply won't
  // trade with anyone it has soured on.
  if (pl) {
    const lots = state.market ?? [];
    const hasLot = (side: MarketSide, resource: string): boolean =>
      lots.some((l) => l.owner === ai && l.side === side && l.resource === resource);
    for (const good of ['food', 'energy', 'microelectronics']) {
      const have = pl.resources[good] ?? 0;
      const reserve = good === 'microelectronics' ? 40 : 120; // the working stock it keeps
      if (have >= reserve + 40 && !hasLot('sell', good))
        out.push(marketList(ai, 'sell', good, Math.floor((have - reserve) / 2), 2));
    }
    if (
      (pl.resources.metal ?? 0) < 80 &&
      (pl.resources.credits ?? 0) > 300 &&
      !hasLot('buy', 'metal')
    ) {
      out.push(marketList(ai, 'buy', 'metal', 30, 3));
    }
  }
  return out;
}

