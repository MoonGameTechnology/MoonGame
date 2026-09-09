/**
 * Шипнутый каталог контента для тех, у кого НЕТ файловой системы, — браузерных
 * потребителей (`packages/client`, `prototype`). Фрагменты `data/*.json` вшивает
 * сборщик (Vite у клиента, esbuild у прототипа), а собирает их ТОТ ЖЕ
 * `composeGameDataBundle`, что читает сервер с диска: список фрагментов один на всех,
 * форкнутой копии нет.
 *
 * Лежит на верхнем уровне, а не внутри пакета, по образцу `localization/core.ts`:
 * потребителя два, и оба — не серверные. Класть это в `shared-core` нельзя: сервер
 * ОБЯЗАН читать каталог с диска (его подменяют при эксплуатации, а `hashGameDataBundle`
 * ловит подмену под живым матчем), и вшитая копия рядом в том же пакете рано или поздно
 * заслонит собой дисковую.
 *
 * Почему список опасен сам по себе (AUD-1): каждое поле каталога в `schemas.ts` несёт
 * `.default({})`, поэтому НЕ переданный фрагмент не роняет загрузку — zod подставляет
 * пустую запись, и приложение получает валидный бандл с молча пропавшим контентом. Так
 * до браузера доехали 11 фрагментов из 18, а весь слой героев и модулей корабля был
 * пуст. Отсюда сторож в `bundle.test.ts`: список сверяется с тем, что композер реально
 * спрашивает, а не с соседней строкой.
 */
import { loadGameData } from '../packages/shared-core/src/index';
import type { GameData } from '../packages/shared-core/src/index';

import manifest from './manifest.json';
import resources from './resources.json';
import units from './units.json';
import factions from './factions.json';
import buildings from './buildings.json';
import events from './events.json';
import sectors from './sectors.json';
import sectorKinds from './sectorKinds.json';
import planetTypes from './planetTypes.json';
import technologies from './technologies.json';
import scientists from './scientists.json';
import modules from './modules.json';
import heroes from './heroes.json';
import heroAbilities from './heroAbilities.json';
import heroPassives from './heroPassives.json';
import heroSkillTrees from './heroSkillTrees.json';
import heroGrades from './heroGrades.json';
import modes from './modes.json';
import rewards from './rewards.json';
import market from './market.json';

/** Копия списка фрагментов для сборщика. Экспортирована, чтобы сторож мог сверить её с
 *  тем, что `composeGameDataBundle` реально запрашивает: разъехавшись, они НЕ роняют
 *  загрузку (см. шапку), поэтому расхождение ловится только тестом. */
export const FRAGMENTS: Record<string, unknown> = {
  'manifest.json': manifest,
  'resources.json': resources,
  'units.json': units,
  'factions.json': factions,
  'buildings.json': buildings,
  'events.json': events,
  'sectors.json': sectors,
  'sectorKinds.json': sectorKinds,
  'planetTypes.json': planetTypes,
  'technologies.json': technologies,
  'scientists.json': scientists,
  'modules.json': modules,
  'heroes.json': heroes,
  'heroAbilities.json': heroAbilities,
  'heroPassives.json': heroPassives,
  'heroSkillTrees.json': heroSkillTrees,
  'heroGrades.json': heroGrades,
  'modes.json': modes,
  'rewards.json': rewards,
  'market.json': market,
};

/** Валидированный шипнутый бандл, собранный общим загрузчиком. */
export function shippedGameData(): GameData {
  return loadGameData((name) => FRAGMENTS[name]);
}
