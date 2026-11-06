import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
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
  it('keeps same-type formations separate and sends only the chosen group', () => {
    const units = [
      unit({
        unit: 'militia',
        key: 'garrison:healthy',
        group: 'healthy',
        side: 'garrison',
        prepared: true,
        garrison: 4,
        garrisonAll: 4,
        grade: 0,
        battles: 0,
        health: 100,
      }),
      unit({
        unit: 'militia',
        key: 'garrison:wounded',
        group: 'wounded',
        side: 'garrison',
        prepared: true,
        garrison: 4,
        garrisonAll: 4,
        grade: 2,
        battles: 6,
        health: 50,
      }),
      unit({
        unit: 'militia',
        key: 'hold:aboard',
        group: 'aboard',
        side: 'hold',
        prepared: true,
        hold: 2,
        holdAll: 3,
        grade: 1,
        battles: 3,
        health: 75,
        queued: 1,
      }),
    ];
    let inp = input({ units, used: 3 });
    inp = { ...inp, plan: stepPlan(inp, 'garrison:wounded', 2) };
    inp = { ...inp, plan: stepPlan(inp, 'hold:aboard', -5) };
    const model = troopsModel(inp);
    expect(model.rows.map((r) => r.delta)).toEqual([0, 2, -2]);
    expect(planOrders(model)).toEqual({
      load: [{ unit: 'militia', count: 2, group: 'wounded' }],
      unload: [{ unit: 'militia', count: 2, group: 'aboard' }],
    });
    const html = troopsMenuHtml(model, { name: (u) => u, icon: () => '' });
    expect(html).toContain('Здоровье: 50%');
    expect(html).toContain('Выслуга: 2');
    expect(html).toContain('Боёв: 6');
  });

  it('does not send a selection until the server identifies its formation', () => {
    const model = troopsModel(
      input({
        units: [
          unit({
            unit: 'militia',
            key: 'pending',
            side: 'garrison',
            prepared: false,
            garrison: 4,
            garrisonAll: 4,
          }),
        ],
        plan: { pending: 2 },
      }),
    );
    expect(model.valid).toBe(false);
    expect(model.rows[0]!.maxLoad).toBe(0);
    expect(planOrders(model)).toEqual({ load: [], unload: [] });
  });
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

  it('ещё не завершённая выгрузка не обещает место под погрузку', () => {
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
    // Места освободятся только через час, после завершения выгрузки.
    expect(m.rows[1]!.maxLoad).toBe(0);
    expect(m.freeCargo).toBe(3);
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
    expect(html).toContain('data-cmd="tstep" data-unit="militia" data-group="militia" data-n="1"');
    expect(html).toContain('data-cmd="tstep" data-unit="militia" data-group="militia" data-n="-1"');
    expect(html).toContain(
      'data-cmd="tmax" class="tall btn-quiet" data-unit="militia" data-group="militia" data-dir="1"',
    );
    expect(html).toContain(
      'data-cmd="tmax" class="tall btn-quiet" data-unit="militia" data-group="militia" data-dir="-1"',
    );
    expect(html).toContain('MILITIA');
    expect(html).toContain('5 ▸ 0');
  });

  it('подтверждение выключено, пока план пуст, и включается с планом', () => {
    expect(troopsMenuHtml(troopsModel(input()), opts)).toContain(
      'data-cmd="tok" class="cbtn btn-main" disabled',
    );
    const withPlan = troopsMenuHtml(troopsModel(input({ plan: { militia: 2 } })), opts);
    expect(withPlan).toContain('data-cmd="tok" class="cbtn btn-main">Подтвердить');
  });

  it('кнопки погрузки гаснут, когда брать нечего', () => {
    const html = troopsMenuHtml(
      troopsModel(input({ units: [unit({ unit: 'militia', hold: 1, holdAll: 1 })] })),
      opts,
    );
    expect(html).toContain(
      'data-n="1" title="▲ Погрузить MILITIA" aria-label="▲ Погрузить MILITIA" disabled',
    );
    expect(html).toContain('data-n="-1" title="▼ Выгрузить MILITIA"');
    expect(html).not.toContain(
      'data-n="-1" title="▼ Выгрузить MILITIA" aria-label="▼ Выгрузить MILITIA" disabled',
    );
  });

  it('причина серой кнопки написана в меню, а не спрятана в тултип', () => {
    const full = troopsMenuHtml(troopsModel(input({ capacity: 2, used: 2 })), opts);
    expect(full).toContain('трюм полон');
    const dry = troopsMenuHtml(
      troopsModel(
        input({ units: [unit({ unit: 'militia', garrison: 2, garrisonAll: 2, reserved: 2 })] }),
      ),
      opts,
    );
    expect(dry).toContain('в гарнизоне не осталось');
  });

  it('сноски: очередь и одинаковое время погрузки и выгрузки', () => {
    const html = troopsMenuHtml(
      troopsModel(
        input({ units: [unit({ unit: 'militia', garrison: 1, garrisonAll: 4, queued: 2 })] }),
      ),
      opts,
    );
    expect(html).not.toContain('повреждённые части');
    expect(html).toContain(t('troops.transferring', { n: 2 }));
    // Час — на ЗАКАЗ, а не на единицу: подпись врала ровно этим словом. Правило
    // одно и живёт в ядре (CARGO-1), поэтому и подпись теперь называет его точно.
    expect(html).toContain(t('troops.timing'));
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
    const html = troopsMenuHtml(
      troopsModel(input({ units: [unit({ unit: 'militia', queued: 1 })] })),
      opts,
    );
    expect(html).not.toContain('pn-timer');
    expect(html).not.toContain('data-at=');
  });
});

describe('кого грузить первыми (раненых или здоровых)', () => {
  const mixed = (plan: Record<string, number>, asking = false) =>
    input({ units: [unit({ unit: 'militia', garrison: 5, garrisonAll: 5, wounded: 2 })], plan, asking });

  it('спрашивает, только если в гарнизоне есть и раненые, и целые, а берётся не всё', () => {
    expect(troopsModel(mixed({ militia: 3 })).askFirst).toBe(true);
    expect(troopsModel(mixed({ militia: 5 })).askFirst).toBe(false); // берут всех — порядок не важен
    expect(troopsModel(mixed({ militia: -1 })).askFirst).toBe(false); // выгрузка не спрашивает
    const allHealthy = input({ units: [unit({ unit: 'militia', garrison: 5, garrisonAll: 5, wounded: 0 })], plan: { militia: 3 } });
    expect(troopsModel(allHealthy).askFirst).toBe(false);
    const allWounded = input({ units: [unit({ unit: 'militia', garrison: 5, garrisonAll: 5, wounded: 5 })], plan: { militia: 3 } });
    expect(troopsModel(allWounded).askFirst).toBe(false);
  });

  it('на вопросе вместо «Подтвердить» — две кнопки выбора и отмена', () => {
    const o = { icon: () => '', name: (u: string) => u };
    const html = troopsMenuHtml(troopsModel(mixed({ militia: 3 }, true)), o);
    expect(html).toContain('Кого грузить первыми?');
    expect(html).toContain('data-cmd="tfirst" data-first="wounded"');
    expect(html).toContain('data-cmd="tfirst" data-first="healthy"');
    expect(html).not.toContain('data-cmd="tok"');
    expect(troopsMenuHtml(troopsModel(mixed({ militia: 3 })), o)).toContain('data-cmd="tok"');
  });
});


describe('compact formation transfer', () => {
  it('shows only the selected direction and bounds both quantity controls by available cargo', () => {
    const units = [
      unit({ unit: 'militia', key: 'garrison:g', group: 'g', side: 'garrison', prepared: true,
        garrison: 6, garrisonAll: 6, hp: 524, maxHp: 600, health: 87.3 }),
      unit({ unit: 'militia', key: 'hold:h', group: 'h', side: 'hold', prepared: true,
        hold: 2, holdAll: 2, hp: 140, maxHp: 200, health: 70 }),
    ];
    const model = troopsModel(input({ units, capacity: 4, used: 2, plan: { 'garrison:g': 1 } }));
    const opts = { name: () => '<Infantry>', icon: () => '', world: '<METIS>' };
    const load = troopsMenuHtml(model, { ...opts, direction: 'load' });
    expect(load).toContain('data-troop-group="garrison:g"');
    expect(load).not.toContain('data-troop-group="hold:h"');
    expect(load).toContain('87.3%');
    expect(load).toContain('524/600');
    expect(load).toContain('&lt;Infantry&gt;');
    expect(load).toContain('&lt;METIS&gt;');
    expect(load.match(/min="0" max="2" step="1" value="1"/g)).toHaveLength(2);
    const unload = troopsMenuHtml(troopsModel(input({ units, used: 2 })), { ...opts, direction: 'unload' });
    expect(unload).toContain('data-troop-group="hold:h"');
    expect(unload).not.toContain('data-troop-group="garrison:g"');
    expect(unload).toContain('data-dir="-1"');
    expect(unload).toContain('aria-labelledby="troops-tab-unload"');
  });
});
