// SHU-3.1 — сторож на то, что челноки вообще ВИДНЫ игроку.
//
// Дефект, который чинит кирпич: вкладка «Крылья» показывала гарнизон, а челнок с
// SHU-1.1 в гарнизоне не бывает — он в `planet.hangar`. Вкладка была гарантированно
// пустой, построенные машины исчезали для игрока, и применить их было нечем.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { data } from './gameData';
import { dockedCarrier, fleetHangar, hasHangar, planetHangar, transferOffer } from './hangarPanel';
import type { Fleet, Planet } from '../../packages/shared-core/src/index';

const port = (over: Partial<Planet> = {}): Planet => ({
  id: 'A',
  owner: 'p1',
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [{ type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp }],
  garrison: [],
  traits: [],
  ...over,
});

/** Мир с портом — для сверки «носитель читается как порт». */
const portOf = (): Planet => port();

const carrier = (over: Partial<Fleet> = {}): Fleet => ({
  id: 'F',
  owner: 'p1',
  location: 'A',
  movement: null,
  units: [{ unit: 'shuttle_carrier', count: 1 }],
  traits: [],
  battleId: null,
  ...over,
});

describe('SHU-3.1 — ангар МИРА виден игроку', () => {
  it('ЧЕЛНОКИ БЕРУТСЯ ИЗ АНГАРА, А НЕ ИЗ ГАРНИЗОНА — их там не бывает', () => {
    const p = port({
      hangar: [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 2 }] }],
      garrison: [{ unit: 'militia', count: 5 }],
    });
    const v = planetHangar(p, data)!;
    expect(v.stacks).toEqual([{ unit: 'interceptor', count: 2 }]);
    expect(v.used).toBe(2);
  });

  it('ПУСТОЙ ПОРТ ПОКАЗЫВАЕТСЯ: «0 из N» говорит «сюда можно строить»', () => {
    const v = planetHangar(port(), data)!;
    expect(hasHangar(v)).toBe(true);
    expect(v.used).toBe(0);
    expect(v.bay).toBeGreaterThan(0);
    expect(v.blocked).toBe('empty');
  });

  it('НЕТ ПОРТА — НЕТ БЛОКА ВОВСЕ, а не «0 из 0»', () => {
    expect(planetHangar(port({ buildings: [] }), data)).toBeNull();
  });

  it('выбитый стек в состав не попадает', () => {
    const v = planetHangar(port({ hangar: [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 0 }] }] }), data)!;
    expect(v.stacks).toEqual([]);
    expect(v.free).toBe(v.bay);
  });

  it('ТРИ ПРИЧИНЫ «НЕЛЬЗЯ ЛЕТЕТЬ» НАЗЫВАЮТСЯ РАЗНЫМИ СЛОВАМИ', () => {
    const full = { hangar: [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 1 }] }] };
    expect(planetHangar(port(full), data)!.blocked).toBeNull();
    expect(planetHangar(port({ ...full, sortie: { fuel: 2, rearming: 3 } }), data)!.blocked).toBe(
      'rearming',
    );
    expect(planetHangar(port({ ...full, sortie: { fuel: 0, rearming: 0 } }), data)!.blocked).toBe(
      'no-fuel',
    );
    expect(planetHangar(port(), data)!.blocked).toBe('empty');
  });

  it('топливо — счётчик МЕСТА, и у пустого порта его не показывают', () => {
    expect(planetHangar(port(), data)!.sortie).toBeUndefined();
    const v = planetHangar(port({ hangar: [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 1 }] }] }), data)!;
    expect(v.sortie?.maxFuel).toBe(data.units.interceptor!.stats.fuel);
  });
});

describe('SHU-3.1 — трюм НОСИТЕЛЯ виден той же формой', () => {
  it('«Шаттл» несёт ангар, и его состав читается так же, как у порта', () => {
    const v = fleetHangar(carrier({ hangar: [{ id: 'sq:1', units: [{ unit: 'bomber', count: 2 }] }] }), data)!;
    expect(v.used).toBe(2);
    expect(v.bay).toBe(data.units.shuttle_carrier!.stats.shuttleBay);
  });

  it('обычный корабль ангара не несёт — блока нет', () => {
    expect(fleetHangar(carrier({ units: [{ unit: 'cruiser', count: 3 }] }), data)).toBeNull();
  });
});

describe('SHU-3.1 — перегрузка порт ⇄ носитель предлагается, только если ПРОЙДЁТ', () => {
  const full = planetHangar(port({ hangar: [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 2 }] }] }), data);
  const empty = planetHangar(port(), data);
  const hold = fleetHangar(carrier(), data);
  const heldFull = fleetHangar(
    carrier({ hangar: [{ id: 'sq:1', units: [{ unit: 'bomber', count: data.units.shuttle_carrier!.stats.shuttleBay! }] }] }),
    data,
  );

  it('носитель у мира и место есть — можно поднять на борт', () => {
    expect(transferOffer(full, hold, { docked: true, mine: true }).load).toBe(true);
  });

  it('пустой порт поднимать нечем, полный трюм принять не может', () => {
    expect(transferOffer(empty, hold, { docked: true, mine: true }).load).toBe(false);
    expect(transferOffer(full, heldFull, { docked: true, mine: true }).load).toBe(false);
  });

  it('в трюме есть машины и порт не полон — можно ссадить', () => {
    expect(transferOffer(empty, heldFull, { docked: true, mine: true }).unload).toBe(true);
  });

  it('НОСИТЕЛЬ НЕ У МИРА ИЛИ НЕ СВОЙ — КНОПОК НЕТ ВОВСЕ, а не серых', () => {
    expect(transferOffer(full, hold, { docked: false, mine: true })).toEqual({
      load: false,
      unload: false,
    });
    expect(transferOffer(full, hold, { docked: true, mine: false })).toEqual({
      load: false,
      unload: false,
    });
  });

  it('корабль без ангара перегрузку не предлагает', () => {
    const plain = fleetHangar(carrier({ units: [{ unit: 'cruiser', count: 1 }] }), data);
    expect(transferOffer(full, plain, { docked: true, mine: true })).toEqual({
      load: false,
      unload: false,
    });
  });
});

// Перегрузка ИЗ ПАНЕЛИ МИРА — дефект, найденный в живой игре: у игрока был «Шаттл», а
// кнопок он не нашёл. Функционально всё работало, но кнопки стояли ТОЛЬКО на панели
// флота-носителя, а челноки игрок видит и строит во вкладке мира «Эскадра». Место, где
// лежат машины, и место, где их можно погрузить, оказались разными панелями.
describe('перегрузка предлагается и со стороны МИРА', () => {
  const shuttles = [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 2 }] }];

  it('НОСИТЕЛЬ У ЭТОГО МИРА НАХОДИТСЯ — панель мира знает, кому грузить', () => {
    const f = carrier();
    expect(dockedCarrier([f], 'A', 'p1', data)?.id).toBe('F');
  });

  it('ЧУЖОЙ, В ПУТИ, В БОЮ ИЛИ У ДРУГОГО МИРА — не кандидат', () => {
    expect(dockedCarrier([carrier({ owner: 'p2' })], 'A', 'p1', data)).toBeNull();
    expect(dockedCarrier([carrier({ location: 'B' })], 'A', 'p1', data)).toBeNull();
    expect(dockedCarrier([carrier({ battleId: 'b1' })], 'A', 'p1', data)).toBeNull();
    const flying = carrier({ movement: { from: 'A', to: 'B', departedAt: 0, arrivesAt: 1 } });
    expect(dockedCarrier([flying], 'A', 'p1', data)).toBeNull();
  });

  it('КОРАБЛЬ БЕЗ АНГАРА НЕ НОСИТЕЛЬ: обычный флот у мира кнопок не даёт', () => {
    const plain = carrier({ units: [{ unit: 'cruiser', count: 1 }] });
    expect(dockedCarrier([plain], 'A', 'p1', data)).toBeNull();
  });

  it('НОСИТЕЛЕЙ ДВА — КНОПКИ НЕТ: грузить «в какой-нибудь» нельзя', () => {
    // Цена ошибки здесь выше, чем у выбора звена (`transferPick`): машины уедут с чужим
    // флотом. Пока выбора списком нет, панель мира молчит, а адресный приказ остаётся
    // на панели самого носителя — там цель однозначна.
    const two = [carrier(), carrier({ id: 'F2' })];
    expect(dockedCarrier(two, 'A', 'p1', data)).toBeNull();
  });

  it('вместе с `transferOffer` даёт ровно те же кнопки, что и панель флота', () => {
    const f = carrier();
    const p = port({ hangar: shuttles });
    const found = dockedCarrier([f], 'A', 'p1', data)!;
    const offer = transferOffer(planetHangar(p, data), fleetHangar(found, data), {
      docked: true,
      mine: true,
    });
    expect(offer).toEqual({ load: true, unload: false });
  });
});

// Само ПОДКЛЮЧЕНИЕ вкладки живёт в `main.ts`, у которого юнит-обвязки нет, — поэтому
// сканом исходника, как в `rankScreen.test.ts`. Именно подключения и не хватало:
// решение (`transferOffer`) было верным и покрытым, а звать его со стороны мира было
// некому, и для игрока механики не существовало.
describe('вкладка мира «Эскадра» подключена к перегрузке', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const tab = src.slice(src.indexOf("planetTab === 'shuttle'"), src.indexOf("planetTab === 'shuttle'") + 2000);

  it('вкладка спрашивает, есть ли у мира носитель', () => {
    expect(tab).toContain('dockedCarrier(');
  });

  it('и рисует те же две кнопки, что панель флота', () => {
    expect(tab).toContain("btn('wingload'");
    expect(tab).toContain("btn('wingunload'");
  });

  it('кнопка адресует ФЛОТ — обработчик `wingload` ждёт id носителя, а не мира', () => {
    // Адресуй она мир, приказ ушёл бы в никуда: `wingload` резолвит флот по `arg`.
    expect(tab).toMatch(/btn\('wingload', ship\.id/);
    expect(tab).toMatch(/btn\('wingunload', ship\.id/);
  });
});

// ТРЮМ НОСИТЕЛЯ ГОВОРИТ ПРАВДУ — дефект живой игры: «эскадрильи не атакуют с шаттла».
// Две разные поломки с одним симптомом. Первая: `sortieSpec` читала челноков в
// `fleet.units` (место мёртвого «крыла», снятого в SHU-2.2), а на носителе там стоит
// КОРПУС без `fuel` — полный трюм читался сухим, и кнопка удара не оживала никогда.
// Вторая: панель не знала про «вылет только со стоянки», предлагала «Удар» идущему
// носителю и получала `E_FLEET_BUSY` уже ПОСЛЕ прицеливания.
describe('трюм носителя читается как порт и знает про стоянку', () => {
  const squad = [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 2 }] }];
  const moving = { from: 'A', to: 'B', departedAt: 0, arrivesAt: 1 };

  it('ПОЛНЫЙ ТРЮМ НЕ СУХОЙ: топливо берётся у машины в ангаре, а не у корпуса', () => {
    const v = fleetHangar(carrier({ hangar: squad }), data)!;
    expect(v.blocked).toBeNull();
    expect(v.sortie?.maxFuel).toBeGreaterThan(0);
  });

  it('И СОВПАДАЕТ С ПОРТОМ ПРИ ТОМ ЖЕ АНГАРЕ — одно правило, одно чтение', () => {
    const hold = fleetHangar(carrier({ hangar: squad }), data)!;
    const port = planetHangar({ ...portOf(), hangar: squad }, data)!;
    expect(hold.sortie).toEqual(port.sortie);
    expect(hold.blocked).toBe(port.blocked);
  });

  /**
   * ИДУЩИЙ НОСИТЕЛЬ ПОДНИМАЕТ ВЫЛЕТ (решение владельца 2026-09-16). Раньше панель гасила
   * «Удар» на ходу, зеркаля прежнее правило ядра, — и это была ЕДИНСТВЕННАЯ причина серой
   * кнопки, на которую жаловался владелец. Ядро правило сняло, панель идёт следом: она
   * зеркалит гейт, а не хранит свою копию.
   */
  it('ИДЁТ — кнопка ЖИВАЯ: вылет с хода разрешён', () => {
    const v = fleetHangar(carrier({ hangar: squad, location: null, movement: moving }), data)!;
    expect(v.blocked).toBeNull();
  });

  it('БЕЗ УЗЛА, НО НЕ В БОЮ — тоже живая: стоянка на лейне вылету не помеха', () => {
    expect(fleetHangar(carrier({ hangar: squad, location: null }), data)!.blocked).toBeNull();
  });

  it('В БОЮ — «занят»: это единственное, что осталось от прежних трёх условий', () => {
    expect(fleetHangar(carrier({ hangar: squad, battleId: 'b1' }), data)!.blocked).toBe('busy');
  });

  it('ПУСТОЙ ТРЮМ В ПУТИ — «пусто»: поднимать нечего независимо от стоянки', () => {
    const v = fleetHangar(carrier({ location: null, movement: moving }), data)!;
    expect(v.blocked).toBe('empty');
  });
});

/**
 * ЧЕЙ ЭТО АНГАР — часть данных, а не догадка разметки.
 *
 * Найдено после SHU-3.1: одна и та же секция рисует и порт мира, и трюм носителя, а
 * заголовок в ней стоял ОДИН — «Ангар порта». На идущем «Шаттле» игрок читал про порт
 * строку о корабле; та же подмена была во второй строке — «порт перезаряжается».
 * Поэтому место называет себя само: `kind` приходит из того, кто построил вид.
 */
describe('SHU-3.1 — ангар называет, ЧЕЙ он', () => {
  it('порт мира — это порт', () => {
    expect(planetHangar(port(), data)!.kind).toBe('port');
  });

  it('трюм носителя — это трюм, а не порт', () => {
    expect(fleetHangar(carrier(), data)!.kind).toBe('hold');
  });

  it('вид знает своё место в любом состоянии — и пустой, и полный, и в пути', () => {
    const full = { hangar: [{ id: 'sq:1', units: [{ unit: 'bomber', count: 2 }] }] };
    expect(fleetHangar(carrier(full), data)!.kind).toBe('hold');
    expect(fleetHangar(carrier({ ...full, movement: { from: 'A', to: 'B', departedAt: 0, arrivesAt: 1 } }), data)!.kind).toBe('hold');
    expect(planetHangar(port({ hangar: full.hangar }), data)!.kind).toBe('port');
  });
});
