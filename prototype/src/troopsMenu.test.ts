import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import {
  maxPlan,
  planOrders,
  stepPlan,
  troopsMenuHtml,
  troopsModel,
  type TroopsInput,
  type TroopsUnitInput,
} from './troopsMenu';

beforeAll(() => setLocale('ru')); // под Node рантайм иначе фолбэчится в EN

const unit = (over: Partial<TroopsUnitInput> & { unit: string }): TroopsUnitInput => ({
  garrison: 0,
  garrisonAll: 0,
  hold: 0,
  holdAll: 0,
  queued: 0,
  reserved: 0,
  cargoSize: 1,
  ...over,
});

const input = (over: Partial<TroopsInput> = {}): TroopsInput => ({
  units: [unit({ unit: 'militia', garrison: 5, garrisonAll: 5 })],
  capacity: 8,
  used: 0,
  reservedCargo: 0,
  plan: {},
  ...over,
});

describe('troopsModel — сколько влезет', () => {
  it('пустой план ничего не подтверждает', () => {
    const m = troopsModel(input());
    expect(m.valid).toBe(false);
    expect(m.loadTotal).toBe(0);
    expect(m.unloadTotal).toBe(0);
  });

  it('потолок погрузки — минимум из гарнизона и свободного трюма', () => {
    const m = troopsModel(input({ capacity: 3 }));
    expect(m.rows[0]!.maxLoad).toBe(3); // в гарнизоне 5, но трюм на 3
  });

  it('cargoSize > 1 делит трюм, а не занимает его поштучно', () => {
    const m = troopsModel(
      input({
        units: [unit({ unit: 'tank', garrison: 9, garrisonAll: 9, cargoSize: 3 })],
        capacity: 8,
      }),
    );
    expect(m.rows[0]!.maxLoad).toBe(2); // floor(8 / 3), а не 8
  });

  it('уже погруженный десант и очередь вычитаются из трюма', () => {
    const m = troopsModel(input({ capacity: 8, used: 3, reservedCargo: 2 }));
    expect(m.rows[0]!.maxLoad).toBe(3); // 8 − 3 занято − 2 в очереди
  });

  it('зарезервированные очередью единицы вычитаются из гарнизона', () => {
    const m = troopsModel(
      input({ units: [unit({ unit: 'militia', garrison: 5, garrisonAll: 5, reserved: 4 })] }),
    );
    expect(m.rows[0]!.maxLoad).toBe(1); // 5 − 4 обещано другим погрузкам
  });

  it('побитые стеки видно, но поднять нельзя', () => {
    const m = troopsModel(
      input({ units: [unit({ unit: 'militia', garrison: 2, garrisonAll: 7 })] }),
    );
    expect(m.rows[0]!.maxLoad).toBe(2); // здоровых только 2 из 7
    expect(m.anyDamaged).toBe(true);
  });

  it('строки делят один трюм: избыточная погрузка гасится', () => {
    const m = troopsModel(
      input({
        units: [
          unit({ unit: 'militia', garrison: 5, garrisonAll: 5 }),
          unit({ unit: 'tank', garrison: 5, garrisonAll: 5 }),
        ],
        capacity: 4,
        plan: { militia: 3, tank: 3 },
      }),
    );
    expect(m.loadTotal).toBe(4); // 3 + 3 не влезают в 4 — вторая строка урезана
    expect(m.freeCargo).toBe(0);
  });

  it('выгрузка в том же плане освобождает место под погрузку', () => {
    const m = troopsModel(
      input({
        units: [
          unit({ unit: 'tank', hold: 3, holdAll: 3 }),
          unit({ unit: 'militia', garrison: 9, garrisonAll: 9 }),
        ],
        capacity: 4,
        used: 4, // трюм забит танками (4 из 4)
        plan: { tank: -3 },
      }),
    );
    // высадив 3 танка, освобождаем 3 места — ополчение туда влезает
    expect(m.rows[1]!.maxLoad).toBe(3);
  });

  it('нельзя выгрузить больше, чем на борту', () => {
    const m = troopsModel(
      input({
        units: [unit({ unit: 'militia', hold: 2, holdAll: 2 })],
        plan: { militia: -9 },
      }),
    );
    expect(m.rows[0]!.delta).toBe(-2);
    expect(m.unloadTotal).toBe(2);
  });

  it('«трюм полон» видно, пока в гарнизоне есть кого брать', () => {
    const m = troopsModel(input({ capacity: 2, used: 2 }));
    expect(m.holdFull).toBe(true);
    expect(m.garrisonDry).toBe(false);
  });

  it('«в гарнизоне не осталось» — когда всё разобрано очередями', () => {
    const m = troopsModel(
      input({ units: [unit({ unit: 'militia', garrison: 3, garrisonAll: 3, reserved: 3 })] }),
    );
    expect(m.garrisonDry).toBe(true);
    expect(m.holdFull).toBe(false);
  });

  it('игрок, набравший весь гарнизон сам, не получает НИ ОДНОЙ сноски-преграды', () => {
    // Регресс живой проверки: «трюм полон» показывалось при пустом трюме 0/11 —
    // флаг ловил «все строки на максимуме», а максимум упирался в гарнизон.
    const m = troopsModel(
      input({
        units: [
          unit({ unit: 'militia', garrison: 2, garrisonAll: 2 }),
          unit({ unit: 'heavy_infantry', garrison: 1, garrisonAll: 1 }),
        ],
        capacity: 11,
        plan: { militia: 2, heavy_infantry: 1 },
      }),
    );
    expect(m.loadTotal).toBe(3);
    expect(m.holdFull).toBe(false);
    expect(m.garrisonDry).toBe(false);
  });

  it('пустой гарнизон при гружёном трюме — тоже без сносок', () => {
    const m = troopsModel(
      input({ units: [unit({ unit: 'militia', hold: 3, holdAll: 3 })], capacity: 8, used: 3 }),
    );
    expect(m.holdFull).toBe(false);
    expect(m.garrisonDry).toBe(false);
  });
});

describe('stepPlan / maxPlan — шаг клампится, а не блокируется', () => {
  it('«+5» при трёх доступных даёт +3, а не отказ', () => {
    const plan = stepPlan(input({ capacity: 3 }), 'militia', 5);
    expect(plan['militia']).toBe(3);
  });

  it('шаг вниз уходит в отрицательную дельту (выгрузка) и упирается в трюм', () => {
    const inp = input({ units: [unit({ unit: 'militia', hold: 2, holdAll: 2 })] });
    expect(stepPlan(inp, 'militia', -1)['militia']).toBe(-1);
    expect(stepPlan({ ...inp, plan: { militia: -2 } }, 'militia', -1)['militia']).toBe(-2);
  });

  it('шаг по неизвестному типу не трогает план', () => {
    const inp = input({ plan: { militia: 2 } });
    expect(stepPlan(inp, 'ghost', 1)).toEqual({ militia: 2 });
  });

  it('пресеты набивают трюм и высаживают всё своё', () => {
    const inp = input({
      units: [unit({ unit: 'militia', garrison: 5, garrisonAll: 5, hold: 2, holdAll: 2 })],
      capacity: 8,
      used: 2,
    });
    expect(maxPlan(inp, 'militia', 1)['militia']).toBe(5); // трюма на 6, в гарнизоне 5
    expect(maxPlan(inp, 'militia', -1)['militia']).toBe(-2);
  });
});

describe('planOrders — во что превращается план', () => {
  it('делит на выгрузку и погрузку по знаку дельты', () => {
    const m = troopsModel(
      input({
        units: [
          unit({ unit: 'militia', garrison: 5, garrisonAll: 5 }),
          unit({ unit: 'tank', hold: 2, holdAll: 2 }),
        ],
        capacity: 8,
        used: 2,
        plan: { militia: 3, tank: -2 },
      }),
    );
    const o = planOrders(m);
    expect(o.load).toEqual([{ unit: 'militia', count: 3 }]);
    expect(o.unload).toEqual([{ unit: 'tank', count: 2 }]);
  });

  it('нулевые дельты не порождают приказов', () => {
    expect(planOrders(troopsModel(input()))).toEqual({ load: [], unload: [] });
  });
});

describe('troopsMenuHtml — разметка поповера', () => {
  const opts = { icon: () => '<svg/>', name: (u: string) => u.toUpperCase() };

  it('строка на тип несёт кнопки шага и пресетов с id юнита', () => {
    const html = troopsMenuHtml(troopsModel(input()), opts);
    expect(html).toContain('class="cmdpop tpop"');
    expect(html).toContain('data-cmd="tstep" data-unit="militia" data-n="1"');
    expect(html).toContain('data-cmd="tstep" data-unit="militia" data-n="-1"');
    expect(html).toContain('data-cmd="tmax" class="tall" data-unit="militia" data-dir="1"');
    expect(html).toContain('data-cmd="tmax" class="tall" data-unit="militia" data-dir="-1"');
    expect(html).toContain('MILITIA');
    expect(html).toContain('5 ▸ 0');
  });

  it('подтверждение выключено, пока план пуст, и включается с планом', () => {
    expect(troopsMenuHtml(troopsModel(input()), opts)).toContain(
      'data-cmd="tok" class="cbtn" disabled',
    );
    const withPlan = troopsMenuHtml(troopsModel(input({ plan: { militia: 2 } })), opts);
    expect(withPlan).toContain('data-cmd="tok" class="cbtn">Подтвердить');
  });

  it('кнопки погрузки гаснут, когда брать нечего', () => {
    const html = troopsMenuHtml(
      troopsModel(input({ units: [unit({ unit: 'militia', hold: 1, holdAll: 1 })] })),
      opts,
    );
    expect(html).toContain('data-n="1" title="▲ Погрузить MILITIA" aria-label="▲ Погрузить MILITIA" disabled');
    expect(html).toContain('data-n="-1" title="▼ Выгрузить MILITIA"');
    expect(html).not.toContain('data-n="-1" title="▼ Выгрузить MILITIA" aria-label="▼ Выгрузить MILITIA" disabled');
  });

  it('причина серой кнопки написана в меню, а не спрятана в тултип', () => {
    const full = troopsMenuHtml(troopsModel(input({ capacity: 2, used: 2 })), opts);
    expect(full).toContain('трюм полон');
    const dry = troopsMenuHtml(
      troopsModel(input({ units: [unit({ unit: 'militia', garrison: 2, garrisonAll: 2, reserved: 2 })] })),
      opts,
    );
    expect(dry).toContain('в гарнизоне не осталось');
  });

  it('сноски: побитые не грузятся, очередь, асимметрия времени', () => {
    const html = troopsMenuHtml(
      troopsModel(input({ units: [unit({ unit: 'militia', garrison: 1, garrisonAll: 4, queued: 2 })] })),
      opts,
    );
    expect(html).toContain('повреждённые части на борт не поднимаются');
    expect(html).toContain('⏳ грузится: 2');
    expect(html).toContain('погрузка ≈1 ч за единицу · выгрузка сразу');
  });

  it('шапка показывает, каким трюм СТАНЕТ, и сводку плана', () => {
    const html = troopsMenuHtml(
      troopsModel(input({ capacity: 8, used: 2, reservedCargo: 1, plan: { militia: 3 } })),
      opts,
    );
    expect(html).toContain('трюм 6/8'); // 2 на борту + 1 в очереди + 3 по плану
    expect(html).toContain('заказано +3');
  });

  it('в разметке нет живых тикающих чисел — только счётные', () => {
    // Покадровый дифф ряда переписал бы DOM под пальцем: таймеров тут быть не должно.
    const html = troopsMenuHtml(troopsModel(input({ units: [unit({ unit: 'militia', queued: 1 })] })), opts);
    expect(html).not.toContain('pn-timer');
    expect(html).not.toContain('data-at=');
  });
});
