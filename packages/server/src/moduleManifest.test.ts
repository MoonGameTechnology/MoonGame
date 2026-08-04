/**
 * СТОРОЖ МАНИФЕСТА — `DEV_MODULES` против `MODULE_MANIFEST_VERSION`.
 *
 * Инвариант #6: порядок выполнения модулей = порядок массива в `createKernel`, и он
 * зафиксирован ПОМАТЧЕВО (`state.version.manifest`). Загрузчик (`serverWiring.ts`)
 * отказывается поднимать матч, чей закреплённый манифест не совпал с задеплоенным, —
 * иначе живой матч молча доигрывался бы по другим правилам, а его реплей перестал бы
 * воспроизводиться.
 *
 * Но вся эта защита держится на РУЧНОЙ дисциплине: «поправил `DEV_MODULES` — не забудь
 * поднять `MODULE_MANIFEST_VERSION`». Забыл — и проверка на загрузке пропускает матч,
 * потому что версия-то не изменилась. Проверять нечего: строка сама себя не знает.
 *
 * Этот файл замыкает контур. Список ниже — граф модулей, за который отвечает ТЕКУЩАЯ
 * версия манифеста. Любая правка `DEV_MODULES` (добавили модуль, убрали, переставили)
 * роняет тест, и починить его можно ровно одним способом: поднять
 * `MODULE_MANIFEST_VERSION` и перезакрепить список — то есть сделать осознанно то, что
 * иначе забылось бы.
 *
 * Область — ЧЛЕНСТВО И ПОРЯДОК, ровно как формулирует правило рядом с самой константой.
 * `version` отдельного модуля намеренно не закрепляется: это другой сигнал и другое
 * решение, и молча расширять контракт тестом было бы неправильно.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '@void/shared-core';
import { createDevMatch, DEV_MODULES, MODULE_MANIFEST_VERSION, loadShippedData } from './scenario';

/** Версия манифеста, для которой закреплён список ниже. Разъехалась с
 *  `MODULE_MANIFEST_VERSION` → список устарел, его надо перезакрепить. */
const PINNED_FOR_VERSION = '3';

/** Граф модулей версии `PINNED_FOR_VERSION` — идентификаторы В ПОРЯДКЕ ВЫПОЛНЕНИЯ.
 *  Не алфавит и не набор: порядок здесь и есть предмет договора (инвариант #6). */
const PINNED_MODULE_IDS = [
  'sector',
  'planet-type',
  'tax',
  'economy',
  'movement',
  'hero',
  'diplomacy',
  // Боевая семья, разложенная по швам шины: orbital штампует орбиту до combat,
  // а свой залп отрабатывает до artillery.
  'orbital',
  'combat',
  'artillery',
  'intercept',
  'capture-on-arrival',
  'construction',
  'arsenal-sync',
  'station',
  'technology',
  'scientist',
  'faction',
  'market',
  'army',
  'fleet-ops',
  'capital',
  'standing-orders',
  'instant-repair',
  'fleet-repair',
  'forced-march',
  'victory',
  'visibility',
  // 'division' СНЯТ ОСОЗНАННО (H4-REVERT, 2026-07-31), не потерян при правке.
  // Игра вернулась к системе отдельных наземных юнитов: armyModule возит UnitStack'и
  // между гарнизоном и трюмом, combatModule разрешает десант — этот путь никогда не
  // исчезал, дивизии стояли ПАРАЛЛЕЛЬНО ему. Прежде чем вписывать 'division' обратно,
  // прочти причину отката в docs/backlog.md: возврат строки откатывает решение
  // владельца, а не чинит опечатку.
];

describe('сторож манифеста', () => {
  it('закреплённый список относится к текущей MODULE_MANIFEST_VERSION', () => {
    // Подняли версию — значит граф изменился: перезакрепите PINNED_MODULE_IDS ниже
    // и обновите PINNED_FOR_VERSION.
    expect(MODULE_MANIFEST_VERSION).toBe(PINNED_FOR_VERSION);
  });

  it('состав и порядок DEV_MODULES не менялись без подъёма версии манифеста', () => {
    const ids = createKernel(DEV_MODULES).manifest.modules.map((m) => m.id);
    // Правили DEV_MODULES? Поднимите MODULE_MANIFEST_VERSION (scenario.ts) и перенесите
    // новый порядок сюда — иначе живые матчи молча доиграются на другом графе модулей.
    expect(ids).toEqual(PINNED_MODULE_IDS);
  });

  it('свежий матч штампует эту версию в state.version.manifest', () => {
    // Связь между константой и тем, что реально ложится в снапшот и проверяется на
    // загрузке: разорвись она — сторож стерёг бы пустоту.
    const room = createDevMatch(loadShippedData(), { now: () => 1000, time: 1000 });
    expect(room.state.version.manifest).toBe(MODULE_MANIFEST_VERSION);
  });
});
