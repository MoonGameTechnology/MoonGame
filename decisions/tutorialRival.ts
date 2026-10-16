/**
 * Соперник обучения основной игры (заказ владельца 2026-10-16: «боты подыгрывали к этим
 * задачам, но так, чтобы игрок мог победить в любом случае»).
 *
 * Обучение учит обороне, слежке и нападению, а этому не научить на пустой карте: нужен
 * тот, кто нападёт, за кем следить и на кого напасть. Обычный бот (`ai.ts`) для этого не
 * годится даже слабым — он строится, расширяется и может задавить новичка, который ещё
 * ищет кнопку. Поэтому соперник обучения — НЕ ИИ, а сценарий из трёх правил:
 *
 * 1. **Сосед, а не край карты.** Бот сидит на ближайшем к дому игрока мире: рейд и ответный
 *    удар — один перелёт, а не полкарты. Обучение должно быть коротким.
 * 2. **Слабее игрока по построению.** Гарнизон его мира пуст, флот — один корабль. Игрок к
 *    рейду уже держит на орбите два корабля (стартовый и построенный на уроке), так что
 *    оборона выигрывается без вариантов, а мир бота берётся первым же кораблём на орбите.
 *    Казна игрока поднята до пола, которого хватает на все покупки уроков: обучение не
 *    должно упираться в «копите металл».
 * 3. **Ходит только по сигналу обучения.** Сам бот ничего не строит и никуда не летит; один
 *    раз, когда обучение доходит до урока обороны, его флот берёт курс на дом игрока.
 *    Приказ идёт обычным действием через ядро — его правила в силе, подделки мира нет.
 *
 * Модуль чистый: ни DOM, ни часов. Что считать «сейчас урок обороны», решает хост.
 */
import type { Action, GameState, PlayerId } from '../packages/shared-core/src/index';
import { moveFleet } from './actions';

/** Пол казны игрока на старте обучения (правило 2): улучшение добычи, исследование
 *  форта, корабль, сам форт и шпионаж — с запасом. */
export const TUTOR_PURSE: Readonly<Record<string, number>> = { credits: 500, metal: 600 };

interface WorldLike {
  id: string;
  kind?: string;
  position: { x: number; y: number };
  links?: readonly string[];
}

/**
 * Где посадить бота (правило 1): ближайший СОСЕДНИЙ с домом игрока мир-планета. Нет
 * такого — ближайшая планета вообще (карта без соседей-планет всё равно даёт сопернику
 * место). Ничья — по id, чтобы выбор не зависел от порядка ключей.
 */
export function tutorStart(
  planets: Readonly<Record<string, WorldLike>>,
  home: string,
): string | null {
  const at = planets[home];
  if (!at) return null;
  const dist = (p: WorldLike): number =>
    Math.hypot(p.position.x - at.position.x, p.position.y - at.position.y);
  const pick = (pool: WorldLike[]): string | null =>
    pool.sort((a, b) => dist(a) - dist(b) || (a.id < b.id ? -1 : 1))[0]?.id ?? null;
  const worlds = Object.values(planets).filter(
    (p) => p.id !== home && (p.kind ?? 'planet') === 'planet',
  );
  return pick(worlds.filter((p) => at.links?.includes(p.id))) ?? pick(worlds);
}

/**
 * Мир обучения (правило 2): гарнизоны бота пусты, у бота один флот из одного корабля,
 * казна игрока не ниже `TUTOR_PURSE`. Вход не меняется — возвращается новое состояние.
 */
export function tutorWorld(state: GameState, me: PlayerId, bot: PlayerId): GameState {
  const planets = { ...state.planets };
  for (const p of Object.values(planets))
    if (p.owner === bot) planets[p.id] = { ...p, garrison: [] };
  const fleets = { ...state.fleets };
  const own = Object.values(fleets).filter((f) => f.owner === bot);
  own.forEach((f, i) => {
    const first = f.units[0];
    if (i === 0 && first) fleets[f.id] = { ...f, units: [{ ...first, count: 1 }], landing: [] };
    else delete fleets[f.id];
  });
  const player = state.players[me];
  const players = { ...state.players };
  if (player) {
    const resources = { ...player.resources };
    for (const [res, floor] of Object.entries(TUTOR_PURSE))
      resources[res] = Math.max(resources[res] ?? 0, floor);
    players[me] = { ...player, resources };
  }
  return { ...state, planets, fleets, players };
}

/**
 * Приказы бота в этом кадре (правило 3). `raid` — обучение дошло до урока обороны: флот
 * бота, который ещё стоит, берёт курс на `target` (дом игрока). Летящий, уже стоящий у
 * цели или погибший флот приказа не получает — повторный вызов каждый кадр безопасен.
 */
export function tutorOrders(
  state: GameState,
  bot: PlayerId,
  target: string,
  raid: boolean,
): Action[] {
  if (!raid || state.players[bot]?.status !== 'active') return [];
  const fleet = Object.values(state.fleets).find(
    (f) => f.owner === bot && f.units.some((u) => u.count > 0),
  );
  if (!fleet || fleet.movement || fleet.location === target) return [];
  return [moveFleet(bot, fleet.id, target)];
}
