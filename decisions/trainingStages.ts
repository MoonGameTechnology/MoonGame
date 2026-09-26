/**
 * ЭТАПЫ УЧЕБНОГО ПОЛИГОНА (TRN-2, `docs/sector-zero-map-concepts.md` §14.4): засчитан ли
 * этап по ДЕЙСТВИТЕЛЬНОМУ результату игры.
 *
 * Правила:
 *
 * 1. **Этап закрывает дело, а не «Понятно».** Каждая проверка читает состояние мира: корабль
 *    сошёл с верфи, технология изучена, мир взят, патруль уничтожен. Подсказка, которую
 *    игрок просто пролистал, этап не засчитывает — так и требует §14.4.
 * 2. **Рост считается от отметки на старте.** База полигона уже стоит с фортом, верфью и
 *    флотом, поэтому «построил форт» — это фортов СТАЛО больше, чем было при входе, а не
 *    «форт где-то есть». Отметку снимает {@link trainingBaseline} один раз, в начале.
 * 3. **Только своё.** Проверки смотрят на миры, флоты и постройки игрока `me`; чужой форт
 *    или чужой корабль этап не засчитывает.
 *
 * Чистые функции состояния: ни DOM, ни часов. Что показать в подсказке и куда указать —
 * цепочка `prototype/src/trainingTour.ts`.
 */
import type { GameData, GameState, PlayerId } from '../packages/shared-core/src/index';

/** Двенадцать этапов §14.4 в порядке прохождения. */
export const TRAINING_STAGES = [
  'prep',
  'economy',
  'research',
  'expand',
  'missions',
  'fleet',
  'battle',
  'retreat',
  'carrier',
  'assault',
  'fortify',
  'finale',
] as const;
export type TrainingStage = (typeof TRAINING_STAGES)[number];

/** Отметка на входе в полигон: от неё считается рост (правило 2). */
export interface TrainingBaseline {
  /** Сумма уровней производящих построек игрока (`produces`). */
  production: number;
  ships: number;
  techs: number;
  forts: number;
  defenses: number;
}

const myFleets = (s: GameState, me: PlayerId) => Object.values(s.fleets).filter((f) => f.owner === me);

/** Кораблей во флотах игрока (челноки в ангарах — не корабли флота). */
export function shipCount(s: GameState, me: PlayerId): number {
  return myFleets(s, me).reduce((n, f) => n + f.units.reduce((m, u) => m + u.count, 0), 0);
}

/** Построек вида `type` на мирах игрока. */
export function buildingCount(s: GameState, me: PlayerId, type: string): number {
  return Object.values(s.planets)
    .filter((p) => p.owner === me)
    .reduce((n, p) => n + p.buildings.filter((b) => b.type === type).length, 0);
}

/** Сумма уровней производящих построек на мирах игрока: растёт и от новой постройки,
 *  и от улучшения старой — этап экономики засчитывает любое из двух. */
export function productionLevel(s: GameState, me: PlayerId, data: GameData): number {
  return Object.values(s.planets)
    .filter((p) => p.owner === me)
    .reduce(
      (n, p) =>
        n +
        p.buildings
          .filter((b) => Object.keys(data.buildings[b.type]?.produces ?? {}).length > 0)
          .reduce((m, b) => m + (b.level ?? 1), 0),
      0,
    );
}

/** Изученных игроком технологий. */
export function techCount(s: GameState, me: PlayerId): number {
  return s.players[me]?.technologies?.completed?.length ?? 0;
}

export function trainingBaseline(s: GameState, me: PlayerId, data: GameData): TrainingBaseline {
  return {
    production: productionLevel(s, me, data),
    ships: shipCount(s, me),
    techs: techCount(s, me),
    forts: buildingCount(s, me, 'fort'),
    defenses: buildingCount(s, me, 'orbital_aa'),
  };
}

/** Добыча выросла: построена или улучшена производящая постройка. */
export const productionGrew = (s: GameState, me: PlayerId, b: TrainingBaseline, data: GameData): boolean =>
  productionLevel(s, me, data) > b.production;

/** Корабль сошёл с верфи. */
export const shipBuilt = (s: GameState, me: PlayerId, b: TrainingBaseline): boolean => shipCount(s, me) > b.ships;

/** Технология изучена (не начата — изучена). */
export const techDone = (s: GameState, me: PlayerId, b: TrainingBaseline): boolean => techCount(s, me) > b.techs;

/** Мир принадлежит игроку. */
export const owns = (s: GameState, me: PlayerId, planetId: string): boolean => s.planets[planetId]?.owner === me;

/** Флота больше нет — уничтожен в бою. */
export const fleetGone = (s: GameState, fleetId: string): boolean => {
  const f = s.fleets[fleetId];
  return !f || f.units.every((u) => u.count <= 0);
};

/** Свой флот стоит на орбите мира — орбита очищена от защитников. */
export const inOrbit = (s: GameState, me: PlayerId, planetId: string): boolean =>
  myFleets(s, me).some((f) => f.location === planetId && f.orbit === 'near');

/** Эскадра вернулась: ни один вылет игрока не в воздухе, а в ангаре носителя снова машины. */
export const squadronHome = (s: GameState, me: PlayerId): boolean =>
  !(s.strikes ?? []).some((st) => st.owner === me) &&
  myFleets(s, me).some((f) => (f.hangar ?? []).some((sq) => sq.units.some((u) => u.count > 0)));

/** Форт и орбитальная оборона поставлены сверх того, что было на входе. */
export const fortified = (s: GameState, me: PlayerId, b: TrainingBaseline): boolean =>
  buildingCount(s, me, 'fort') > b.forts && buildingCount(s, me, 'orbital_aa') > b.defenses;

/** На своём мире оставлен гарнизон. */
export const garrisoned = (s: GameState, me: PlayerId, planetId: string): boolean =>
  owns(s, me, planetId) && (s.planets[planetId]?.garrison ?? []).some((g) => g.count > 0);

/** Операция окончена победой игрока: взята последняя планета противника. */
export const trainingWon = (s: GameState, me: PlayerId): boolean =>
  s.match.status === 'ended' && s.match.winner === me;
