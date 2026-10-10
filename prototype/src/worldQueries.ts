/**
 * Запросы к миру и очередь стройки (REFM-242): то, чем интерфейс матча спрашивает мир
 * о своём. Мир по id (`planet`), своя казна и хватит ли её (`myRes`, `afford`), очередь
 * полосы из ядра и цена ждущего заказа (`coreQueue`, `buildCost`), идущая стройка и её
 * подписи (`activeConstruction`, `constructionLabel`, `queuedLabel`, `timeLeft`,
 * `progressPct`) и сам заказ (`enqueueBuild`). Ими пользуются карточка мира, боковая
 * панель и окно построек.
 *
 * Своего состояния у модуля нет: очередь живёт в ядре (`Planet.buildQueue`, BLD-1), а
 * правила цены, полос и порядка — в `buildOrders.ts` и `buildProgress.ts`. Мир на экране,
 * своё место, тост, имя места, путь приказа и замок одноэкземплярного здания живут в
 * `main.ts`; модуль получает их хуками {@link initWorldQueries} — импорт оттуда был бы
 * циклом.
 */
import type {
  Action,
  GameState,
  Planet,
  QueuedConstruction,
} from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { refusalText as errText } from '../../decisions/refusalText';
import {
  afford as coreAfford,
  laneOf,
  queuedAction as coreQueuedAction,
  queuedCost,
} from './buildOrders';
import {
  activeConstruction as coreActiveConstruction,
  buildDurationHours as coreBuildDurationHours,
  hoursLeft,
  progressPct as coreProgressPct,
} from './buildProgress';
import type { ActiveBuild, BuildLane, ConstructionPayload, QueuedBuild } from './buildQueue';
import type { TileLock } from './catalogTile';
import { displayUnit, fmtEta } from './format';
import { data } from './gameData';
import { pcUi } from './graphicsPrefs';
import { BUILD_ICON, unitIcon } from './icons';
import { HOUR } from './time';

/** Что запросам к миру нужно от игры. Мир, место, лента и путь приказа — в `main.ts`. */
export interface WorldQueriesHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Тост в ленту событий. */
  note(msg: string): void;
  /** Имя мира для тоста — с учётом тумана и переименований. */
  placeName(id: string): string;
  /** Приказ игрока: в соло — в редьюсер, в сети — намерением в сокет. */
  playerOrder(action: Action): boolean;
  /** Почему здание нельзя заказать: уже стоит или уже ждёт (одноэкземплярные). */
  buildingLocked(planetId: string, id: string): TileLock;
}

let game: WorldQueriesHost;

/** Поднять запросы к миру: хуки игры. Зовётся из `main.ts` один раз, до первого кадра. */
export function initWorldQueries(host: WorldQueriesHost): void {
  game = host;
}

export const planet = (id: string | null | undefined): Planet | undefined =>
  id ? game.world().planets[id] : undefined;
/** Казна текущего игрока — то самое `have`, которым cost() красит нехватку. */
export function myRes(): Record<string, number> {
  return game.world().players[game.me()]?.resources ?? {};
}
export function afford(bag: Record<string, number> | undefined): boolean {
  return coreAfford(myRes(), bag);
}
/** Ждущие заказы этой полосы — из ЯДРА (BLD-1): очередь больше не локальная. */
export function coreQueue(planetId: string, lane: BuildLane): QueuedConstruction[] {
  return (game.world().planets[planetId]?.buildQueue ?? []).filter((q) => laneOf(q.kind) === lane);
}
/** Цена ждущего заказа — ДЛЯ ПОКАЗА (строка «⏳ ждём: …»); правила масштаба и смещения
 *  уровней живут в `buildOrders.ts` (REFM-32). */
export function buildCost(
  planetId: string,
  q: QueuedConstruction,
): Record<string, number> | undefined {
  const id = q.building ?? q.unit;
  if (id === undefined) return undefined;
  return queuedCost(game.world(), data, planetId, {
    kind: q.kind,
    id,
    count: q.count ?? 1,
    ...(q.troop !== undefined ? { troop: q.troop } : {}),
  });
}
/** Приказ, которым голова очереди уедет в ядро. */
export function queuedAction(planetId: string, q: QueuedBuild): Action {
  return coreQueuedAction(game.me(), planetId, q);
}
/** Стройка, идущая на мире прямо сейчас (голову по `(at, seq)` выбирает
 *  `buildProgress.ts`, REFM-31 — там же и правило порядка). */
export function activeConstruction(planetId: string, lane: BuildLane): ActiveBuild | null {
  return coreActiveConstruction(game.world(), planetId, lane);
}
export function constructionLabel(p: ConstructionPayload): string {
  if (p.kind === 'unit' && p.unit) {
    return `${p.count ?? 1}× ${unitIcon(p.unit, data)} ${displayUnit(p.unit)}`;
  }
  if (p.kind === 'upgrade' && p.building) {
    return `${BUILD_ICON[p.building] ?? '▣'} ${tData(data.buildings[p.building]?.name ?? p.building)} → L${p.level ?? '?'}`;
  }
  if (p.building) {
    return `${BUILD_ICON[p.building] ?? '▣'} ${tData(data.buildings[p.building]?.name ?? p.building)}`;
  }
  return t('queue.unknown');
}
export function buildDurationHours(p: ConstructionPayload): number {
  return coreBuildDurationHours(p, data);
}
export function timeLeft(at: number): string {
  return fmtEta(hoursLeft(at, game.world().time, HOUR));
}
export function progressPct(active: ActiveBuild): number {
  return coreProgressPct(active, game.world().time, data, HOUR);
}
export function queuedLabel(q: QueuedBuild): string {
  if (q.kind === 'unit') {
    // PC: icon·count chips (like the garrison tiles) — the hover dossier names the
    // unit. Mobile keeps the full name.
    if (pcUi()) return `${unitIcon(q.id, data)} ${q.count}`;
    return `${q.count}× ${unitIcon(q.id, data)} ${displayUnit(q.id)}`;
  }
  if (q.kind === 'upgrade') {
    return t('queue.upgrade', {
      b: `${BUILD_ICON[q.id] ?? '▣'} ${tData(data.buildings[q.id]?.name ?? q.id)}`,
    });
  }
  return `${BUILD_ICON[q.id] ?? '▣'} ${tData(data.buildings[q.id]?.name ?? q.id)}`;
}
/**
 * BLD-1. Приказ всегда уезжает В ЯДРО — очередь живёт там.
 *
 * Раньше здесь стояла развилка: в сети приказ отправлялся сразу («сервер таймит
 * стройку»), а в соло ложился в ЛОКАЛЬНУЮ очередь прототипа. Из-за неё сеть и соло
 * играли по разным правилам, и на живом плейтесте это вылезло ровно так, как и должно
 * было: в сети каждый тап заводил ЕЩЁ ОДНУ параллельную стройку, экран показывал
 * ближайшую, и игрок видел «постройки заменяют друг друга, ресурсы тратятся».
 *
 * Теперь очередь одна и она в ядре (`Planet.buildQueue`): и сервер, и локальный
 * редьюсер прототипа исполняют одно правило, а клиент её только ПОКАЗЫВАЕТ.
 */
export function enqueueBuild(planetId: string, order: QueuedBuild): void {
  // Одна точка опоры против дубля одноэкземплярного здания: плитка, кодекс и любой
  // будущий вход проходят здесь, и серые плитки остаются чистой косметикой.
  if (order.kind === 'building' && game.buildingLocked(planetId, order.id)) {
    game.note(
      '✖ ' +
        errText(
          game.buildingLocked(planetId, order.id) === 'built'
            ? 'E_ALREADY_BUILT'
            : 'E_ALREADY_QUEUED',
        ),
    );
    return;
  }
  // Тост «в очередь» — ПРЕДСКАЗАНИЕ клиента: полоса занята, значит ядро поставит заказ
  // в ряд, а не начнёт его. Держать это предсказание можно ровно потому, что оно
  // косметическое: правду показывает панель конвейера, которая читает состояние, и
  // следующий снимок её поправит. Раньше тост был только в соло — в сети локальной
  // очереди не было вовсе, и тап не отвечал игроку ничем.
  if (activeConstruction(planetId, laneOf(order.kind))) {
    game.note(t('queue.added', { what: queuedLabel(order), at: game.placeName(planetId) }));
  }
  game.playerOrder(queuedAction(planetId, order));
}
