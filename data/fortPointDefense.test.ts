/**
 * ФОРТ ПРИКРЫВАЕТ МИР ОТ ЧЕЛНОКОВ (FORT, решение владельца 7 от 2026-09-15).
 *
 * «Своей зенитки у форта нет — он даёт небольшой дополнительный урон зонального ПВО,
 * складываясь с батареей.» Проверено по коду и оказалось правкой ОДНИХ ДАННЫХ:
 * `planetPointDefense` (`shuttle.ts`) суммирует поле `pointDefense` по ВСЕМ стоящим
 * зданиям, беря значение уровня. Значит форту достаточно объявить поле.
 *
 * Тест поэтому проверяет не «поле записано в json» (это тавтология), а ДВЕ вещи, которые
 * могут разойтись: что форт реально попадает в зенитный счёт мира, и что он СКЛАДЫВАЕТСЯ
 * с батареей, а не заменяет её.
 *
 * ЖИВЁТ РЯДОМ С КАТАЛОГОМ, а не в `shared-core`: ядро намеренно изолировано от шипнутых
 * данных и не имеет права их импортировать (`rootDir` роняет тайпчек на первой же попытке).
 * Это тест про КОНТЕНТ, и его место здесь.
 */
import { describe, it, expect } from 'vitest';
import { buildingLevel, isCapturable, isStationable } from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();

describe('форт — зенитная доля в шипнутых данных', () => {
  it('форт несёт зенитный урон на КАЖДОМ уровне, и тот растёт с прокачкой', () => {
    const fort = data.buildings.fort;
    expect(fort, 'здание fort пропало из каталога').toBeDefined();
    const byLevel = [1, 2, 3].map((lv) => buildingLevel(fort!, lv).pointDefense);
    expect(byLevel.every((pd) => pd > 0), `уровни: ${byLevel.join('/')}`).toBe(true);
    for (let i = 1; i < byLevel.length; i += 1) {
      expect(byLevel[i], `уровень ${i + 1} не сильнее предыдущего`).toBeGreaterThan(
        byLevel[i - 1]!,
      );
    }
  });

  it('форт ОСТАЁТСЯ слабее батареи — иначе отдельное здание обесценилось бы', () => {
    // Решение 7 говорит «небольшой дополнительный», а не «такой же». Если форт максимального
    // уровня догонит `zonal_aa`, строить батарею станет незачем, и решение тихо отменит
    // само здание.
    const maxFort = buildingLevel(data.buildings.fort!, 3).pointDefense;
    const battery = buildingLevel(data.buildings.zonal_aa!, 1).pointDefense;
    expect(battery).toBeGreaterThan(maxFort);
  });

  it('зенитка форта СКЛАДЫВАЕТСЯ с батареей, а не заменяет её', () => {
    // Мир с обоими зданиями обязан бить сильнее, чем с любым одним. Счёт тот же, каким
    // его ведёт ядро: сумма `pointDefense` по стоящим зданиям.
    const pd = (ids: string[]): number =>
      ids.reduce((sum, id) => sum + buildingLevel(data.buildings[id]!, 1).pointDefense, 0);
    expect(pd(['fort', 'zonal_aa'])).toBeGreaterThan(pd(['zonal_aa']));
    expect(pd(['fort', 'zonal_aa'])).toBeGreaterThan(pd(['fort']));
  });

  it('здание БЕЗ поля ведёт себя как раньше — ноль, а не поломка', () => {
    // Схема даёт `pointDefense` дефолт 0, и на этом держится то, что правка форта
    // не тронула ни одно другое здание.
    expect(buildingLevel(data.buildings.mine!, 1).pointDefense).toBe(0);
  });
});

describe('где ставится космическая крепость — решение владельца в шипнутых данных', () => {
  // Решение 2 (§0.6 fortress-roadmap): «на захваченной территории, на ВСЕХ видах, кроме
  // тех, где уже есть планета». Флаг `stationable` записывает ИСКЛЮЧЕНИЯ, а не
  // перечисляет разрешённое, поэтому сторож нужен именно на исключения: перевернуть флаг
  // — одна буква в json, и никакой другой тест этого не заметит.
  const NOT_STATIONABLE = ['planet', 'void_station', 'pirate_base', 'neutral_base'];

  it('крепость НЕЛЬЗЯ ставить ровно там, где решил владелец', () => {
    for (const kind of NOT_STATIONABLE) {
      expect(isStationable(data, { kind }), kind).toBe(false);
    }
  });

  it('на ОСТАЛЬНЫХ видах — можно, и список не пуст', () => {
    const rest = Object.keys(data.sectorKinds).filter((k) => !NOT_STATIONABLE.includes(k));
    expect(rest.length).toBeGreaterThan(0);
    for (const kind of rest) {
      expect(isStationable(data, { kind }), kind).toBe(true);
    }
  });

  it('незахватываемые виды закрыты ВЛАДЕНИЕМ, а не флагом — и это должно оставаться правдой', () => {
    // В данных они `stationable: true`, и это не недосмотр: крепость ставится только на
    // своём узле, а незахватываемое своим не станет никогда. Сторож держит именно это
    // рассуждение: если вид вдруг станет захватываемым, кто-то обязан решить заново,
    // можно ли там крепость, — и тест сообщит об этом падением.
    const uncapturable = Object.keys(data.sectorKinds).filter((k) => !isCapturable(data, { kind: k }));
    // `rift` (MAP-BARRIER, M2.6) присоединился к списку по тому же рассуждению: это дыра
    // в карте, её не захватывают, значит крепости там не будет и без отдельного флага.
    expect(uncapturable.sort()).toEqual(['black_hole', 'debris_field', 'empty', 'rift']);
  });

  it('у КАЖДОГО вида из ростера крепости есть само здание в каталоге', () => {
    // Дыра, которую иначе увидит только игрок: ростер называет id, которого нет, и
    // постройка молча недоступна.
    for (const id of data.sectorKinds.void_station?.allowedBuildings ?? []) {
      expect(data.buildings[id], `в ростере крепости нет здания ${id}`).toBeDefined();
    }
  });
});
