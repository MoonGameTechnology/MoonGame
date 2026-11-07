/**
 * Каталог контента прототипа — теперь ШИПНУТЫЙ бандл `data/*.json` (CONV-12b).
 *
 * До этого прототип читал собственный каталог `prototypeData.ts`: рукописный литерал,
 * разошедшийся с бандлом на 274 расхождения (CONV-11 их пересчитал, CONV-12a свёл к 99,
 * приведя канон к числам прототипа). Здесь прототип начинает читать канон — тот же
 * `composeGameDataBundle`, что читает сервер с диска, только фрагменты вшивает сборщик
 * (см. `data/bundle.ts`, там же почему это не живёт в `shared-core`).
 *
 * Модуль намеренно тонкий: у него ровно одна задача — отдать `data` тем же именем и той
 * же формой, какой её отдавал `prototypeData.ts`, чтобы переезд двадцати двух импортов
 * был сменой ПУТИ, а не правкой каждого места использования.
 */
import { shippedGameData } from '../../data/bundle';
import { hashGameDataBundle, parseGameData, type GameData } from '../../packages/shared-core/src/index';
import type { MatchRulesCatalog } from '../../packages/protocol/src/index';
import { applyBalanceFlags, parseBalanceFlags } from '../../decisions/remoteBalance';
import { getRemoteFlags } from './platform/host';

/** Валидированный каталог игры. Собирается один раз на загрузку модуля — как и прежний
 *  литерал, который `parseGameData` проверял на том же месте. Числа баланса поверх него —
 *  из флагов площадки (`YAG-6.3`), которые `bootstrap.ts` прочитал до импорта игры. */
const defaultData: GameData = applyBalanceFlags(
  shippedGameData(),
  parseBalanceFlags(getRemoteFlags()),
);

/** Live imports read the selected world's catalog; campaign/hub restore the local one. */
export let data: GameData = defaultData;
export function useMatchCatalog(rules?: MatchRulesCatalog): void {
  if (!rules) { data = defaultData; return; }
  if (!/^[a-f0-9]{64}$/.test(rules.id) || rules.version.manifest !== `ruleset:${rules.id}` ||
      rules.data.version !== rules.version.data || hashGameDataBundle(rules.data) !== rules.version.dataHash)
    throw new Error('E_MATCH_RULES_MISMATCH');
  // View defaults can evolve; the server keeps and executes the unchanged native data.
  data = parseGameData(rules.data);
}
