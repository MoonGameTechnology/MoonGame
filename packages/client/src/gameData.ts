/**
 * Browser side of the shared game-data loader (CP0.3). The fragment list itself lives
 * in `data/bundle.ts` — ONE copy for both browser consumers (this client and the
 * prototype), next to the data, the same way `localization/core.ts` is one runtime for
 * both. Re-exported here so this module stays the client's single door to game data.
 * Maps stay local: they are the client's own screens, not shared content.
 */
import { parseMatchMap, buildStateFromMap, mapForDifficulty, pairKey } from '@void/shared-core';
import type { GameData, GameState, MapObjective, MatchMap } from '@void/shared-core';

import { FRAGMENTS, shippedGameData } from '../../../data/bundle';
import skirmishMap from '../../../data/maps/skirmish-1.json';
import pveMap from '../../../data/maps/pve-1.json';
import pveMap2 from '../../../data/maps/pve-2.json';
import pveMap3 from '../../../data/maps/pve-3.json';
import trainingMap from '../../../data/maps/training-1.json';

export { FRAGMENTS, shippedGameData };

/** A ready-to-render single-player `GameState` built from the shipped skirmish map. */
export function skirmishState(data: GameData): GameState {
  return buildStateFromMap(parseMatchMap(skirmishMap), data);
}

/**
 * МИССИИ Сектора Зеро по порядку глав — единственная дверь к их картам.
 *
 * До этого `pveState` статически импортировала ровно `pve-1`, и выбора не было нигде:
 * вторая карта могла лежать в репозитории и не открываться НИКОГДА. В этом проекте так
 * уже случалось трижды (крепость, которую нельзя построить; модуль волн не в том ядре;
 * `station.deploy` без подходящих узлов), поэтому карта и дверь к ней едут вместе.
 *
 * Порядок массива и есть порядок глав. Номер миссии приходит снаружи и КЛАМПИТСЯ:
 * испорченное хранилище или старая ссылка не должны ронять вход в игру — они открывают
 * первую главу, а не падают.
 */
const PVE_MISSIONS = [pveMap, pveMap2, pveMap3];

/** Сколько глав у Сектора Зеро сегодня — чтобы интерфейс не держал своего числа. */
export const PVE_MISSION_COUNT = PVE_MISSIONS.length;

/**
 * Номер главы из хранилища или ссылки → номер, который реально сыграется (0 — первая).
 * Любой номер вне диапазона → ПЕРВАЯ глава.
 *
 * Хост приводит номер ЭТОЙ функцией, а не только карта внутри себя (AUD-32): иначе карта
 * клампила чужой номер к первой главе, а награда главы (чертёж за первую победу) считалась
 * по сырому номеру — «5» из правленого хранилища играло главу I, а платило легендарным
 * чертежом вместо уникального.
 *
 * Именно первая, а не ближайшая: сюда номер приходит из хранилища браузера и из ссылки,
 * то есть испорченное значение — обычный случай, а не авария. Подтянуть его к последней
 * главе значило бы молча ПРОПУСТИТЬ игроку содержимое кампании; открыть первую —
 * поведение, которое он точно поймёт.
 */
export function pveMissionIndex(mission: number): number {
  const i = Number.isInteger(mission) ? mission : Math.trunc(Number(mission));
  return Number.isFinite(i) && i >= 0 && i < PVE_MISSIONS.length ? i : 0;
}

function missionMap(mission: number): unknown {
  return PVE_MISSIONS[pveMissionIndex(mission)] ?? pveMap;
}

/** Разобранная карта главы — один раз на карту. Карты глав — неизменные данные поставки, а
 *  панель задач и метки целей спрашивают главу КАЖДЫЙ кадр: полный разбор zod на кадр был
 *  заметной долей кадра на телефоне (замер 2026-09-24). Мир из карты (`pveState`) по-прежнему
 *  строится из свежего разбора — отдавать общий объект в изменяемый мир нельзя. */
const parsedMissions = new WeakMap<object, MatchMap>();
function parsedMission(mission: number): MatchMap {
  const raw = missionMap(mission) as object;
  let map = parsedMissions.get(raw);
  if (!map) {
    map = parseMatchMap(raw);
    parsedMissions.set(raw, map);
  }
  return map;
}

/** A ready-to-render PvE `GameState` built from the shipped map of that mission. */
export function pveState(data: GameData, mission = 0, difficulty?: string): GameState {
  // Старт главы под сложность забега (PVR-6.32): карта сама объявляет, чем он отличается.
  const map = mapForDifficulty(parseMatchMap(missionMap(mission)), difficulty);
  // Id карты — в сам мир: у глав один режим, и только по карте видно, КАКАЯ это глава.
  // Его читает дескриптор забега (`YAG-2.1`), чтобы восстановить ту же главу, а не первую.
  return { ...buildStateFromMap(map, data), mapId: map.id };
}

/** Глава по id её карты — обратное к {@link pveState}. `null` — такой главы в поставке
 *  нет (карту переименовали или убрали): восстанавливать нечего, угадывать нельзя. */
export function pveMissionOfMap(mapId: string | undefined): number | null {
  const at = PVE_MISSIONS.findIndex((_, i) => parsedMission(i).id === mapId);
  return mapId === undefined || at < 0 ? null : at;
}

/** Дополнительные задачи главы — объявлены в карте, проверяются чистым предикатом
 *  (`decisions/missionObjectives.ts`). Карта без задач отдаёт пустой список, и это
 *  нормальный случай: задачи ДОПОЛНИТЕЛЬНЫЕ. */
export function pveObjectives(mission = 0): MapObjective[] {
  return parsedMission(mission).objectives;
}

/** Глава забега одной структурой (PVR-5.3): id карты — ключ счёта выполненных задач в
 *  профиле, запас задач и правило их показа. */
export function pveChapter(mission = 0): {
  id: string;
  objectives: MapObjective[];
  slots?: { base: number; cap: number };
} {
  const map = parsedMission(mission);
  return {
    id: map.id,
    objectives: map.objectives,
    ...(map.objectiveSlots ? { slots: map.objectiveSlots } : {}),
  };
}

/** The mode the mission's map declares itself played under (`data.modes` id), for the host
 *  to arm the match with. The map carries it so the binding is DATA: the map and the mode
 *  both existed for a long time and nothing said they belonged together. */
export function pveModeId(mission = 0): string | undefined {
  return parsedMission(mission).mode;
}

/**
 * УЧЕБНЫЙ ПОЛИГОН «Протокол допуска» (`docs/sector-zero-map-concepts.md` §14) — не глава:
 * его нет в {@link PVE_MISSIONS}, он не меняет нумерацию глав и не считается их прохождением.
 * Карта фиксированная (§14.3): повтор сохраняет знакомую географию.
 */
let parsedTraining: MatchMap | null = null;
function trainingMatchMap(): MatchMap {
  parsedTraining ??= parseMatchMap(trainingMap);
  return parsedTraining;
}

/** Мир полигона — из свежего разбора, как у глав: общий объект в изменяемый мир не отдаётся.
 *
 *  Стороны полигона ВОЮЮТ с первой минуты. Карта без команд, а загрузчик сажает такую карту
 *  в мир (конвенция free-for-all) — и тогда флот не входит в провинцию противника
 *  (`E_NO_RIGHT_OF_WAY`), то есть полигону нечему учить (найдено аудитом механик, AUDM).
 *  Главам войну объявляет модуль PvE по `npcFaction` режима; у полигона секции `pve` нет,
 *  поэтому противника называет сам полигон: все места карты, кроме обитателей, — враги. */
export function trainingState(data: GameData): GameState {
  const map = parseMatchMap(trainingMap);
  const world = buildStateFromMap(map, data);
  const seats = Object.values(world.players).filter((p) => !p.npc).map((p) => p.id);
  const diplomacy = { ...world.diplomacy };
  for (const a of seats) for (const b of seats) if (a < b) diplomacy[pairKey(a, b)] = 'war';
  // Учебный комплект носителя (§14.4, этап «Носитель и челноки»): эскадра перехватчиков
  // уже в ангаре авианосца. Ангар схема карты не описывает, поэтому комплект кладёт сам
  // полигон — как и войну выше.
  const fleets = { ...world.fleets };
  const carrier = fleets[TRAINING_CARRIER];
  if (carrier)
    fleets[TRAINING_CARRIER] = {
      ...carrier,
      hangar: [{ id: 'sq:training', units: [{ unit: 'interceptor', count: 4 }] }],
    };
  return { ...world, mapId: map.id, diplomacy, fleets };
}

/** Флот учебного авианосца на карте полигона. */
export const TRAINING_CARRIER = 'p1_carrier';

/** Задачи полигона (§14.5): маяк и разведка — дополнительные, победу не определяют. */
export function trainingObjectives(): MapObjective[] {
  return trainingMatchMap().objectives;
}

/** Режим, под которым карта полигона играется (`data.modes`). */
export function trainingModeId(): string | undefined {
  return trainingMatchMap().mode;
}
