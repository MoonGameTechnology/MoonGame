/**
 * Конвейер приказа (REFM-240): путь приказа игрока от нажатия до мира и обратно в ленту.
 * Шаг мира и его события (`apply`), приказ игрока (`playerOrder`: в редьюсер, в сокет или
 * в очередь сети, отказ — в ленту и звуком), бесплатная стройка песочницы вокруг него и
 * рассказы ленты о вахте, своём герое и стройке (`tellSteward`, `tellHero`, `tellBuild`).
 *
 * Конвейер зовут обе линии, поэтому модуль даёт функции, а не состояние. Своё состояние у
 * него одно — снимок положения на момент передачи вахты, по которому утренний доклад
 * считает разницу; его меняет только {@link tellSteward}.
 *
 * Мир на экране и его замена шагом, своё место, разбор событий, лента, имя места, звук
 * отказа, тур обучения, вставки и окно вахты живут в `main.ts`; модуль получает их хуками
 * {@link initOrderPipeline} — импорт оттуда был бы циклом. Сеть (`NET`, клиент, дозвон)
 * читается у её владельца, `netSession.ts`.
 */
import type { Action, DomainEvent, GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { orderPlan } from '../../decisions/orderRoute';
import { refusalText as errText } from '../../decisions/refusalText';
import { buildLogLine, type BuildLogKind } from './buildLog';
import { buildingName, fmtHrs, TECH_CUR } from './format';
import { restoresWallet, snapshotWallet } from './freeBuild';
import { data, HOUR, order, type StepOut } from './game';
import type { HeroNews } from './heroNews';
import { heroDisplayName } from './heroStaff';
import { pruneSelection } from './interaction';
import { introFor } from './introTrigger';
import { NET, netClient, reconnecting } from './netSession';
import { isBuildAction, sandboxConfig } from './sandbox';
import { stewMetrics, type StewardMetrics } from './stewardScreen';
import { decisionsField, diffFields, stewardReport, type StewardEvent } from './stewardLog';

declare const __PLAYER_BUILD__: boolean;

/** Тур обучения, который учится на принятых приказах. */
interface OrderTour {
  readonly active: boolean;
  notifyAction(type: string): void;
}

/** Окно, которое рассказ перерисовывает, если оно открыто. */
interface Repaintable {
  isOpen(): boolean;
  repaint(): void;
}

/** Что конвейеру нужно от игры. Мир, лента, тур и окна живут в `main.ts`. */
export interface OrderPipelineHost {
  /** Мир на экране. */
  world(): GameState;
  /** Заменить мир на экране итогом шага. */
  setWorld(state: GameState): void;
  /** Своё место. */
  me(): string;
  /** Разобрать события шага: лента, тосты, эффекты (REFM-230, линия А). */
  handleEvents(events: DomainEvent[]): void;
  /** Строка в ленту. */
  note(text: string, at?: string): void;
  /** Имя места для игрока. */
  placeName(id: string): string;
  /** Звук отказа: тёмный сбой слышен, не только виден. */
  refusalSound(): void;
  /** Идущий тур обучения, если есть. */
  tour(): OrderTour | null;
  /** Поднять вставку обучения. */
  intro(id: string): void;
  /** Окно вахты, если оно есть в этой сборке. */
  steward(): Repaintable | null;
}

let game: OrderPipelineHost;

/** Поднять конвейер: хуки игры. Зовётся из `main.ts` один раз, до первого кадра. */
export function initOrderPipeline(host: OrderPipelineHost): void {
  game = host;
}

// SANDBOX — fenced hook. In a sandboxed solo match with "free build" on, a build
// order's resource spend is refunded. `order()` advances to `s.time` first (a no-op,
// so no production/upkeep runs), leaving the paid cost as the only resource change —
// snapshotting the treasury before and restoring it after makes the build free.
// Leading `__PLAYER_BUILD__` guard keeps the sandbox tree-shaken from the player bundle.
function sandboxBuildSnapshot(type: string): Record<string, number> | null {
  // Когда песочница возвращает ресурсы — `freeBuild.ts` (REFM-104).
  const armed = snapshotWallet(
    __PLAYER_BUILD__,
    sandboxConfig.enabled,
    sandboxConfig.freeBuild,
    isBuildAction(type),
  );
  return armed ? { ...(game.world().players[game.me()]?.resources ?? {}) } : null;
}
function sandboxBuildRestore(snap: Record<string, number> | null, ok: boolean): void {
  const me = game.world().players[game.me()];
  if (me && restoresWallet(!!snap, ok)) me.resources = snap!;
}

export function apply(out: StepOut) {
  game.setWorld(out.state);
  // Что теряет силу вместе с флотом — владелец выбора (`interaction.ts`, REFM-208) по
  // правилам `selectionPrune.ts`: одиночная ссылка спрашивает только «существует ли», а
  // группа чистится дважды — живые И свои. Тот же вызов стоит в снимке сервера.
  pruneSelection(out.state.fleets, game.me(), out.state.strikes);
  // Режим «Приказ»: пропавшие флоты выбрасываются покадрово в renderChainBar; здесь
  // достаточно ничего не делать — режим сам гаснет, когда fleetIds опустеет.
  game.handleEvents(out.events);
}

/** Apply a player-issued order and surface a rejection in the log (so a denied
 *  click — wrong orbit, no capacity, can't afford — isn't silently swallowed). */
// Имя отказа — `decisions/refusalText.ts` (MIG-2). Правило «ключ выводится из кода»
// осталось тем же, но живёт оно теперь в общей папке: тот же отказ обязан читаться
// одинаково в прототипе и в `packages/client`, а две копии этого не гарантируют.
export function playerOrder(action: Action): boolean {
  // Возврат — «приказ не ОТВЕРГНУТ сейчас»: в соло это честный исход редьюсера,
  // в сети и при реконнекте — true (исход асинхронный). Нужен вызывающим, которые
  // повторяют приказ, — чтобы выбросить отвергнутый, а не пережимать его каждый кадр
  // (бесконечные тосты отказа, живой плейтест).
  // Куда уходит приказ — `orderRoute.ts` (REFM-147): в сети клиент шлёт НАМЕРЕНИЕ и не
  // трогает локальный редьюсер (иначе следующий снимок сотрёт «принятый» приказ), при
  // оборванной связи приказ честно отвергается (сервер о нём не узнает), а обучение
  // учится в сети на намерении, в соло — только на принятом приказе.
  const plan = orderPlan({ net: NET, hasClient: !!netClient, reconnecting });
  if (plan.route === 'send' || plan.route === 'queue') {
    // Один и тот же вызов: живой провод отправляет сразу, оборванный — кладёт в очередь
    // транспорта (NETA2-5), и она уйдёт на реконнектном welcome. Разница только в том,
    // что игроку про очередь говорят — иначе он не поймёт, почему исполнения ещё нет.
    netClient?.sendAction(action); // server is authoritative — await its broadcast
    if (plan.tour === 'now') game.tour()?.notifyAction(action.type); // ответ сервера асинхронен
    if (plan.route === 'queue') game.note('⏳ ' + t('net.queued-order'));
    return true;
  }
  if (plan.route === 'refuse') {
    game.note('⟳ ' + t('net.reconnecting-order'));
    return true;
  }
  const s = game.world();
  const before = sandboxBuildSnapshot(action.type);
  const out = order(s, action, s.time);
  apply(out);
  sandboxBuildRestore(before, !out.error);
  if (out.error) {
    game.refusalSound(); // тёмный сбой — отказ слышен, не только виден
    game.note('✖ ' + errText(out.error));
    return false;
  } else {
    // an accepted intent advances `action` steps
    if (plan.tour === 'on-accept') game.tour()?.notifyAction(action.type);
    // Какой ПРИНЯТЫЙ приказ какую вставку поднимает и почему во время тура молчат все —
    // `introTrigger.ts` (REFM-100).
    const intro = introFor(action.type, !!game.tour()?.active, NET);
    if (intro) game.intro(intro);
  }
  return true;
}

// Snapshot of my standing at delegation time, diffed on expiry for the morning report.
let stewSnapshot: StewardMetrics | null = null;

/** Рассказать игроку о событии вахты — правила в `stewardLog.ts` (REFM-176). */
export function tellSteward(kind: StewardEvent, p: Record<string, unknown>): void {
  const s = game.world();
  const ME = game.me();
  const r = stewardReport(kind, (p as { posture?: string }).posture);
  const base = stewSnapshot;
  stewSnapshot = r.snapshot === 'take' ? stewMetrics(s, ME) : null;
  if (kind === 'expired') {
    const d = diffFields(base, stewMetrics(s, ME), TECH_CUR);
    const dec = decisionsField(s.players[ME]?.stewardLog?.length ?? 0);
    game.note(
      t(r.key) +
        (d ? ' ' + t('log.steward.diff', d) : '') +
        (dec ? ' ' + t('log.steward.decisions', dec) : ''),
    );
  } else {
    game.note(t(r.key));
  }
  const steward = game.steward();
  if (steward?.isOpen()) steward.repaint();
}

/** Рассказать игроку о СВОЁМ герое — правила в `heroNews.ts` (AUD-16): гибель со сроком
 *  попытки возрождения и возвращение в строй. Имя — то же, что в штабе героев. */
export function tellHero(news: HeroNews | null): void {
  if (!news) return;
  const hero = game.world().heroes?.[news.heroId];
  const who = hero ? heroDisplayName(hero) : news.heroId;
  const text =
    news.key === 'log.hero.died'
      ? t(news.key, { who, h: fmtHrs(news.leftMs / HOUR) })
      : news.key === 'log.hero.died.bare'
        ? t(news.key, { who })
        : t(news.key, { who, at: news.at !== undefined ? game.placeName(news.at) : '' });
  game.note(text, news.at);
}

/** Рассказать игроку о событии стройки — правила в `buildLog.ts` (REFM-175). */
export function tellBuild(kind: BuildLogKind, p: Record<string, unknown>): void {
  const line = buildLogLine(kind);
  const b = buildingName(data.buildings[p.building as string]?.name, p.building as string);
  const at = p.planetId as string;
  const where = game.placeName(at);
  const text = line.needsLevel
    ? t(line.key, { b, lvl: String(p.level), at: where })
    : t(line.key, { b, at: where });
  if (line.anchored) game.note(text, at);
  else game.note(text);
}
