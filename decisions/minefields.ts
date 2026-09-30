/**
 * Минные поля на карте и кнопка «Поставить мины» (SM-3.5, `ship-modules-roadmap.md`).
 *
 * Правило постановки живёт в ядре (`modules/minefield.ts`), здесь — только что показать:
 * есть ли у флота заградитель, можно ли ставить сейчас и сколько ждать перезарядки, и
 * какие СВОИ мины стоят на карте. Мина с SM-3.6 — неподвижный отряд во `fleets`; чужую
 * клиент видит, только когда его флот рядом (`mineFleetVisible`).
 */
import {
  bestFleetStat,
  isMineFleet,
  MINE_CHARGE_STAT,
  MINE_HIT_STAT,
  type Fleet,
  type GameData,
  type GameState,
  type MinelayingJob,
} from '../packages/shared-core/src/index';

/** Кнопка постановки на карточке флота. */
export interface MinelayerOffer {
  /** Нажать можно прямо сейчас. */
  ready: boolean;
  /** Почему нельзя: флот идёт или в бою (`busy`), идёт перезарядка (`cooldown`). */
  reason?: 'busy' | 'cooldown' | 'installing';
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
  const job = state.minefields?.installations?.[fleet.id];
  if (job) return { ready: false, reason: 'installing', readyInMs: Math.max(0, job.readyAt - state.time) };
  const readyInMs = Math.max(0, Math.max(state.minefields?.readyAt[fleet.id] ?? 0, state.minefields?.ownerReadyAt?.[me] ?? 0) - state.time);
  if ((fleet.location === null && !fleet.edge) || fleet.movement || fleet.battleId)
    return { ready: false, reason: 'busy', readyInMs };
  if (readyInMs > 0) return { ready: false, reason: 'cooldown', readyInMs };
  return { ready: true, readyInMs: 0 };
}

/** Свои мины (SM-3.6 — отряды во `fleets`): отряд и остаток зарядов, в порядке id. */
export function ownMinefields(
  state: GameState,
  me: string,
  data: GameData,
): Array<{ fleetId: string; charge: number }> {
  return Object.keys(state.fleets)
    .sort()
    .map((id) => state.fleets[id]!)
    .filter((f) => f.owner === me && isMineFleet(f, data))
    .map((f) => ({ fleetId: f.id, charge: f.units.reduce((n, st) => n + st.count, 0) }));
}

/**
 * Свои установки мин (SM-3.4) с носителем — в порядке id. Ключ записи среза и есть id
 * носителя: по нему, а не по ссылке на запись, — клиент читает срез из копии
 * (`visibleMinefields`), и сравнение по ссылке не находило носителя. У установки на узле
 * это пряталось за позицией мира, а дорожная (`location: null`) теряла знак на все
 * 15 минут постановки (ревью #1411).
 */
export function ownInstallations(
  state: GameState,
  me: string,
): Array<{ layerId: string; layer: Fleet | undefined; job: MinelayingJob }> {
  const jobs = state.minefields?.installations ?? {};
  return Object.keys(jobs)
    .sort()
    .filter((id) => jobs[id]!.owner === me)
    .map((id) => ({ layerId: id, layer: state.fleets[id], job: jobs[id]! }));
}
