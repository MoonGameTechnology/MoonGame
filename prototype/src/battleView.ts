/**
 * Проводка окна боя (REFM-246) — заказ владельца 2026-09-15.
 *
 * Значок боя на карте и так показывал фазу и отсчёт до раунда; теперь он ОТКРЫВАЕТСЯ. До
 * этого расклад можно было увидеть единственным путём — выделив свой флот в этом бою, — то
 * есть про чужую схватку рядом узнать было нечем.
 *
 * Само окно (разметка, раскрытые стороны, перерисовка) — `battleScreen.ts`, модель боя —
 * `createBattleModel` клиента, урон и бафы сторон — `battleReadout.ts` ядра, прогноз —
 * `decisions/battleForecast.ts`. Здесь — то, что раньше жило в `main.ts` рядом с ними: кэш
 * разбора боя (он дорогой, и окно перерисовывается чаще, чем есть смысл его пересчитывать),
 * прицел «Отступить всем» и нажатия по плиткам окна. Мир, своё место, имена мест и сторон
 * модуль получает хуками.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import { inspectBattle } from '../../packages/shared-core/src/state/battleReadout';
import { createBattleModel } from '../../packages/client/src/index';
import { attackBattle } from '../../decisions/actions';
import { battleForecast, battleHostility } from '../../decisions/battleForecast';
import { t } from '../../localization/runtime';
import { battleRetreats, initBattleWindow } from './battleScreen';
import { note } from './eventFeed';
import { unitTileHtml } from './fleetCard';
import { fleetCallsign } from './fleetName';
import { esc } from './format';
import { ctx, data } from './game';
import { autoRetreatAt } from './groupOrders';
import { openCodex, openShipCard } from './helpCenter';
import { arm } from './interaction';
import { ownerColor } from './mapPalette';
import { playerOrder } from './orderPipeline';
import { kernel as soloKernel } from './protoKernel';
import { invalidatePanel } from './sidePanel';
import { timeLeft } from './worldQueries';

/** Что окну боя даёт игра: мир, своё место и имена — сторон и мест. */
export interface BattleViewHost {
  world(): GameState;
  me(): string;
  /** Имя места игрока на экране; `undefined` — имени нет, показывается само место. */
  seatName(owner: string): string | undefined;
  placeName(id: string): string;
}

/** Разбор боя дорогой, а окно перерисовывается каждым кадром: пересчёт — не чаще этого. */
const READOUT_EVERY_MS = 250;

let game: BattleViewHost;
let root: HTMLElement;
/** Окно боя; поднимается в {@link initBattleView}. */
export let battleWindow: ReturnType<typeof initBattleWindow>;
/** Бой, из которого взведено «Отступить всем»: прицел ведёт по его флотам по очереди. */
let retreatAim: string | null = null;
let readout: ReturnType<typeof inspectBattle> = {};
let readoutId = '';
let readoutAt = -Infinity;

export function battleRetreatAim(): string | null {
  return retreatAim;
}

export function clearBattleRetreatAim(): void {
  retreatAim = null;
}

/** Взвести «Отступить» для флота: остальные прицелы гаснут, окно боя уступает карту. */
export function armRetreat(fleetId: string): void {
  retreatAim = null;
  arm('retreatAim', fleetId);
  root.classList.remove('show');
  note(t('hint.pick-retreat'));
  invalidatePanel();
}

export function initBattleView(host: BattleViewHost): void {
  game = host;
  root = document.getElementById('battlewin') as HTMLElement;
  battleWindow = initBattleWindow({
    root: () => root,
    body: () => document.getElementById('battlewinbody') as HTMLElement,
    head: () => document.getElementById('battlewinhead') as HTMLElement,
    state: () => game.world(),
    me: () => game.me(),
    model: (id) => {
      const s = game.world();
      // VET-6: тот же конфиг матча, на котором считает редьюсер, — иначе окно показало бы
      // надбавку ветерана там, где хост её не дал.
      const m = createBattleModel(s, id, game.me(), data, ctx(s.time, s).config);
      if (!m.ok) return null;
      const now = performance.now();
      if (id !== readoutId || now - readoutAt >= READOUT_EVERY_MS) {
        readout = inspectBattle(soloKernel, s, ctx(s.time, s), id);
        readoutAt = now;
        readoutId = id;
      }
      for (const side of m.sides) side.readout = side.key ? readout[side.key] : undefined;
      return m;
    },
    attack: (id, side) => playerOrder(attackBattle(game.me(), id, side)),
    retreatAll: (id) => {
      const first = battleRetreats(game.world(), id, game.me())[0];
      if (!first) return;
      armRetreat(first);
      retreatAim = id;
    },
    // Отступление из окна боя — тот же прицел, что и кнопкой боковой панели.
    retreat: (fleetId) => armRetreat(fleetId),
    view: {
      color: ownerColor,
      ownerName: (owner) => (owner ? (game.seatName(owner) ?? owner) : t('side.neutral')),
      tiles: (side, limit, color) =>
        (side.stacks ?? side.units)
          .map((u, index) => ({ u, index }))
          .filter(({ u }) => u.count > 0)
          .slice(0, limit)
          .map(({ u, index }) => {
            const open =
              side.ref?.kind === 'fleet' && side.mine
                ? `data-shipcard="${esc(side.ref.fleetId)}|${index}"`
                : `data-codex="u:${esc(u.unit)}"`;
            return unitTileHtml(u, side.owner, open, true, color);
          })
          .join(''),
      fleetName: fleetCallsign,
      placeName: (id) => game.placeName(id),
      autoRetreatAt,
      timeLeft,
      // UIX-6.2: прогноз по текущему составу сторон — новый раунд сам даёт новый прогноз.
      forecast: (sides) => battleForecast(sides, data, battleHostility(game.world())),
    },
  });
  root.addEventListener('click', (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLButtonElement>('button.ptile');
    if (!tile) return;
    if (tile.dataset.shipcard) {
      const at = tile.dataset.shipcard.lastIndexOf('|');
      openShipCard(tile.dataset.shipcard.slice(0, at), Number(tile.dataset.shipcard.slice(at + 1)));
    } else if (tile.dataset.codex) openCodex(tile.dataset.codex);
  });
}
