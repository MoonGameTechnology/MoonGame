// MIG-10: МОЖНО ЛИ ПОСТАВИТЬ ЗДЕСЬ ЭТО ЗДАНИЕ — один ответ на все кнопки стройки.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Правило было, актора у него не было: `sectorAllowsBuilding`
// в `prototype/src/main.ts` переписывал ворота `building.construct` РУКАМИ, и копия
// была неполной по построению. Ядро спрашивает три вещи — `buildable` вида, ростер
// вида, `onlyOn` самого здания, — а падение клиента к рукописному списку `BUILDABLE`
// знало 11 зданий из 20 шипнутых. Ответы совпадали ПО СОВПАДЕНИЮ: добывающая станция
// не предлагалась на планете не потому, что сработало её `onlyOn`, а потому что её
// случайно не было в списке; верфь же не предлагалась вовсе, хотя редьюсер её принимает.
// Тот же разъезд записан в репозитории как ORB-4.
//
// Поэтому здесь НЕ переписана ни одна проверка: `isBuildable` и `allowedBuildings` —
// ядерные, `onlyOn` читается из того же каталога, что и у редьюсера. Клиентского тут
// только порядок вопросов, и его сводит с настоящим редьюсером `buildGateMirror.test.ts`
// по каждой паре (вид × здание) шипнутого каталога.
//
// Вид берётся у САМОГО УЗЛА (`node.kind`), а не по карте: прототип держал `SECTOR_OF`,
// снятый с `MAP` при установке партии, и после `station.deploy` тот продолжал звать
// астероид астероидом, пока ядро уже считало его крепостью со своим ростером. Решение
// смотрит на живое состояние — расходиться с ним нечему.
//
// Лежит в `/decisions`, а не в `prototype/src`: кнопку стройки рисуют оба клиента.
import { allowedBuildings, isBuildable } from '../packages/shared-core/src/index';
import type { GameData, Planet } from '../packages/shared-core/src/index';
import { isInfected } from '../packages/shared-core/src/util/infestation';

/** Узел, о котором спрашивают: нужен только его вид (`kind`). */
export type BuildNode = Pick<Planet, 'kind'>;

/**
 * Пускает ли вид узла ЭТО здание — тот же вопрос и в том же порядке, что у ворот
 * `building.construct` (три отказа вида там дают `E_WRONG_SECTOR`).
 *
 * `eatsBiomass` — ест ли строитель биомассу (Рой): органы Роя (`infected`) строит только
 * он, иначе редьюсер отказывает `E_SWARM_ONLY` (решение владельца 2026-09-24). Параметр
 * обязательный, чтобы клиент не забыл спросить, КТО строит.
 *
 * Неизвестный каталогу id — `false`: строить нечего. Редьюсер на нём тоже отказывает,
 * просто другим кодом (`E_UNKNOWN_BUILDING`).
 */
export function canBuildHere(
  node: BuildNode,
  building: string,
  data: GameData,
  eatsBiomass: boolean,
): boolean {
  const def = data.buildings[building];
  if (!def) return false;
  if (!eatsBiomass && isInfected(def)) return false;
  if (!isBuildable(data, node)) return false;
  const roster = allowedBuildings(data, node);
  if (roster !== undefined && !roster.includes(building)) return false;
  return def.onlyOn === undefined || def.onlyOn.includes(node.kind ?? '');
}

/**
 * Есть ли на узле хоть одно допустимое здание — гейт кнопки «Постройки».
 *
 * Считается ПЕРЕБОРОМ каталога через {@link canBuildHere}, а не длиной ростера:
 * ростера у вида может не быть вовсе (`undefined` = любое здание), и тогда длина
 * отвечает не на тот вопрос. Перебор к тому же учитывает `onlyOn` — вид, которому
 * каталог не предлагает ничего, честно окажется пустым.
 */
export function buildsAnything(node: BuildNode, data: GameData, eatsBiomass: boolean): boolean {
  return Object.keys(data.buildings).some((building) =>
    canBuildHere(node, building, data, eatsBiomass),
  );
}
