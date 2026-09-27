/**
 * Минные поля на карте и кнопка «Поставить мины» (SM-3.5, `ship-modules-roadmap.md`).
 *
 * Правило постановки живёт в ядре (`modules/minefield.ts`), здесь — только что показать:
 * есть ли у флота заградитель, можно ли ставить сейчас и сколько ждать перезарядки, и
 * какие СВОИ поля лежат на карте. Чужих полей клиент не знает вовсе: проекция тумана
 * (`visibleState`) их вырезает.
 */
import {
  bestFleetStat,
  MINE_CHARGE_STAT,
  MINE_HIT_STAT,
  type Fleet,
  type GameData,
  type GameState,
} from '../packages/shared-core/src/index';

/** Кнопка постановки на карточке флота. */
export interface MinelayerOffer {
  /** Нажать можно прямо сейчас. */
  ready: boolean;
  /** Почему нельзя: флот идёт или в бою (`busy`), идёт перезарядка (`cooldown`). */
  reason?: 'busy' | 'cooldown';
  /** Сколько мировых мс до конца перезарядки (0 — готов). */
  readyInMs: number;
}

/** Кнопка для флота `fleet`; `null` — не показывать (чужой флот или нет заградителя). */
export function minelayerOffer(
  fleet: Fleet,
  state: GameState,
  data: GameData,
  me: string,
): MinelayerOffer | null {
  if (fleet.owner !== me) return null;
  if (!(bestFleetStat(fleet.units, MINE_CHARGE_STAT, data) >= 1)) return null;
  if (!(bestFleetStat(fleet.units, MINE_HIT_STAT, data) > 0)) return null;
  const readyInMs = Math.max(0, (state.minefields?.readyAt[fleet.id] ?? 0) - state.time);
  if (fleet.location === null || fleet.movement || fleet.battleId)
    return { ready: false, reason: 'busy', readyInMs };
  if (readyInMs > 0) return { ready: false, reason: 'cooldown', readyInMs };
  return { ready: true, readyInMs: 0 };
}

/** Свои минные поля: узел и остаток заряда, в порядке узлов. */
export function ownMinefields(
  state: GameState,
  me: string,
): Array<{ node: string; charge: number }> {
  const out: Array<{ node: string; charge: number }> = [];
  for (const [node, byOwner] of Object.entries(state.minefields?.fields ?? {})) {
    const f = byOwner[me];
    if (f && f.charge > 0) out.push({ node, charge: f.charge });
  }
  return out.sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));
}
