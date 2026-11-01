import { describe, it, expect } from 'vitest';
import { cmdShown, type CmdSelection } from './cmdPresence';

const пусто: CmdSelection = {
  stoppable: false,
  castHero: false,
  troops: false,
  assaultArmed: false,
  assaultHere: false,
  bombardReady: false,
  bombarding: false,
  mergeable: false,
  merging: false,
  troopsMenu: false,
  troopsOpen: false,
  troopsInSheet: false,
  more: false,
  picking: false,
};
const с = (p: Partial<CmdSelection>): CmdSelection => ({ ...пусто, ...p });

describe('cmdPresence — что показывается отсутствием (правило 2)', () => {
  it('остановка появляется только когда ядро согласно хоть на один флот', () => {
    expect(cmdShown(пусто).stop).toBe(false);
    expect(cmdShown(с({ stoppable: true })).stop).toBe(true);
  });

  it('способности — только при флагмане с кастуемым на борту', () => {
    expect(cmdShown(пусто).cast).toBe(false);
    expect(cmdShown(с({ castHero: true })).cast).toBe(true);
  });

  // Правило 3а (заказ владельца 2026-09-21). Прежде штурм ВСЕГДА стоял в ряду и лишь
  // гас: эскадра без десанта обещала приказ, который ядро встретит `E_NO_TROOPS`.
  it('ШТУРМ появляется только когда есть кем штурмовать', () => {
    expect(cmdShown(пусто).assault).toBe(false);
    expect(cmdShown(с({ troops: true })).assault).toBe(true);
  });

  // Та же причина, что у набора группы (правило 4): сменил выделение, не сняв прицел —
  // и кнопка унесла бы с собой единственную подпись о том, что он ещё взведён.
  it('ВЗВЕДЁННЫЙ штурм остаётся в ряду, даже когда штурмовать уже некем', () => {
    expect(cmdShown(с({ assaultArmed: true })).assault).toBe(true);
  });
});

// Правило 3г (заказ владельца 2026-11-01): удар по миру под флотом переехал из раздела
// «Удар» листа в ряд и виден, только когда ядро его пропустит.
describe('cmdPresence — удар по миру под флотом (правило 3г)', () => {
  it('ШТУРМ есть и без десанта, когда мир под флотом берётся прямо сейчас', () => {
    expect(cmdShown(с({ assaultHere: true })).assault).toBe(true);
    expect(cmdShown(с({ assaultHere: false, troops: false })).assault).toBe(false);
  });

  it('«Бомбардировка» есть, пока её можно включить или выключить, и не иначе', () => {
    expect(cmdShown(пусто).bombard).toBe(false);
    expect(cmdShown(с({ bombardReady: true })).bombard).toBe(true);
    expect(cmdShown(с({ bombarding: true })).bombard).toBe(true);
  });
});

// Правило 3б (заказ владельца 2026-09-24): «Если сливать нечего, то и кнопки "слить" не
// должно отображаться», «то же самое с кнопкой десант».
describe('cmdPresence — слияние и десант по составу (правило 3б)', () => {
  it('«Слить» нет, когда сливаться не с кем', () => {
    expect(cmdShown(пусто).merge).toBe(false);
    expect(cmdShown(с({ mergeable: true })).merge).toBe(true);
  });

  it('взведённый выбор напарника остаётся в ряду, даже когда напарник пропал', () => {
    expect(cmdShown(с({ merging: true })).merge).toBe(true);
  });

  it('«Десант» нет, когда грузить и высаживать нечего', () => {
    expect(cmdShown(пусто).troops).toBe(false);
    expect(cmdShown(с({ troopsMenu: true })).troops).toBe(true);
  });

  it('открытое меню десанта кнопку не теряет', () => {
    expect(cmdShown(с({ troopsOpen: true })).troops).toBe(true);
  });

  // Правило 3в (макет владельца 2026-09-27): в окне флота консолью ⇅ стоит под таблицей
  // войск кнопкой «Погрузка и выгрузка» — вторая такая же в ряду была бы дублем.
  it('в окне флота консолью ⇅ нет в ряду — ни закрытого, ни открытого', () => {
    expect(cmdShown(с({ troopsMenu: true, troopsInSheet: true })).troops).toBe(false);
    expect(cmdShown(с({ troopsOpen: true, troopsInSheet: true })).troops).toBe(false);
    // Пустой трюм колонку не рисует (`landColumn.ts`) — ⇅ возвращается в ряд.
    expect(cmdShown(с({ troopsMenu: true, troopsInSheet: false })).troops).toBe(true);
  });

  it('десант на борту для штурма и меню десанта — разные вопросы', () => {
    // Трюм полон, но флот в пути: штурмовать есть кем, грузить сейчас нечего.
    const inTransit = cmdShown(с({ troops: true }));
    expect(inTransit.assault).toBe(true);
    expect(inTransit.troops).toBe(false);
  });
});

describe('cmdPresence — набор группы (правило 4)', () => {
  it('видна под раскрытым ☰', () => {
    expect(cmdShown(с({ more: true })).pick).toBe(true);
  });

  it('видна и при СВЁРНУТОМ ☰, если набор уже включён — иначе из режима не выйти', () => {
    expect(cmdShown(с({ more: false, picking: true })).pick).toBe(true);
  });

  it('скрыта, только когда ☰ свёрнут И набор выключен', () => {
    expect(cmdShown(пусто).pick).toBe(false);
  });
});

describe('cmdPresence — редкие команды (правило 5)', () => {
  it('форсаж и стоячие приказы живут только под раскрытым ☰', () => {
    expect(cmdShown(пусто).extras).toBe(false);
    expect(cmdShown(с({ more: true })).extras).toBe(true);
  });

  it('включённый набор сам по себе ☰ не раскрывает', () => {
    expect(cmdShown(с({ picking: true })).extras).toBe(false);
  });
});
