import { describe, it, expect } from 'vitest';
import { splitDialogLives, splitRows, splitDialogHtml } from './splitDialog';
import { cargoSplit, splitSlots } from '../../decisions/splitPlan';

/** Флот без трюма и без десанта — фон для проверок, где важны только корабли. */
const пусто = cargoSplit([], {}, () => 0, () => 1);
const модель = (
  fleetId: string,
  units: Parameters<typeof splitSlots>[0],
  take: Record<string, number> = {},
) => ({ fleetId, rows: splitRows(splitSlots(units), take), cargo: пусто });


const живое = (
  over: Partial<Parameters<typeof splitDialogLives>[0]> = {},
): Parameters<typeof splitDialogLives>[0] => ({
  planFleetId: 'f1',
  selectedFleetId: 'f1',
  fleetExists: true,
  moving: false,
  inBattle: false,
  ...over,
});

describe('окно деления — когда оно живо', () => {
  it('план есть, флот выбран и стоит — окно живо', () => {
    expect(splitDialogLives(живое())).toBe(true);
  });

  it('ПЛАНА НЕТ — НЕТ И ОКНА: закрытое окно не оживает от состояния флота', () => {
    expect(splitDialogLives(живое({ planFleetId: null }))).toBe(false);
  });

  it('ВЫДЕЛЕНИЕ УШЛО НА ДРУГОЙ ФЛОТ: иначе игрок делит не тот флот, что выбран', () => {
    expect(splitDialogLives(живое({ selectedFleetId: 'f2' }))).toBe(false);
    expect(splitDialogLives(живое({ selectedFleetId: null }))).toBe(false);
  });

  it('ФЛОТ ИСЧЕЗ (погиб или слился) — делить нечего', () => {
    expect(splitDialogLives(живое({ fleetExists: false }))).toBe(false);
  });

  it('ПОЛЕТЕЛ — ОКНО ГАСНЕТ: ядро делит только состыкованный, окно обещало бы отказ', () => {
    expect(splitDialogLives(живое({ moving: true }))).toBe(false);
  });

  it('ДЕРЁТСЯ — ТО ЖЕ САМОЕ: в бою состав меняется под пальцем', () => {
    expect(splitDialogLives(живое({ inBattle: true }))).toBe(false);
  });
});

describe('окно деления — строки состава', () => {
  it('СТРОКА НА СТЕК, А НЕ НА ТИП: один корпус с разной начинкой — две строки', () => {
    const rows = splitRows(
      splitSlots([
        { unit: 'fighter', count: 5, modules: ['battery'] },
        { unit: 'fighter', count: 2 },
      ]),
      {},
    );
    expect(rows.map((r) => `${r.unit}:${r.have}`)).toEqual(['fighter:5', 'fighter:2']);
    expect(rows[0]!.modules).toEqual(['battery']);
    expect(rows[0]!.key).not.toBe(rows[1]!.key); // адреса кнопок различимы
  });

  it('остаток и увод считаются от живого состава', () => {
    const slots = splitSlots([
      { unit: 'fighter', count: 5 },
      { unit: 'tanker', count: 2 },
    ]);
    const rows = splitRows(slots, { [slots[0]!.key]: 2 });
    expect(rows.map((r) => ({ unit: r.unit, take: r.take, stay: r.stay }))).toEqual([
      { unit: 'fighter', take: 2, stay: 3 },
      { unit: 'tanker', take: 0, stay: 2 },
    ]);
  });

  it('порядок строк сохраняется — они не прыгают между перерисовками', () => {
    const rows = splitRows(
      splitSlots([
        { unit: 'b', count: 1 },
        { unit: 'a', count: 1 },
        { unit: 'c', count: 1 },
      ]),
      {},
    );
    expect(rows.map((r) => r.unit)).toEqual(['b', 'a', 'c']);
  });

  it('десант идёт своими строками, отдельным видом', () => {
    const rows = splitRows(splitSlots([{ unit: 'fighter', count: 1 }], [{ unit: 'tank', count: 3 }]));
    expect(rows.map((r) => r.kind)).toEqual(['ship', 'landing']);
  });

  it('пустой состав — пустой список строк, а не строка с нулями', () => {
    expect(splitRows([], {})).toEqual([]);
  });
});

describe('окно деления — разметка', () => {
  const hooks = {
    icon: (u: string) => `<i>${u}</i>`,
    name: (u: string) => `имя:${u}`,
    moduleName: (m: string) => `мод:${m}`,
  };

  it('у каждой строки все четыре шага увода', () => {
    const html = splitDialogHtml(модель('f1', [{ unit: 'fighter', count: 5 }]), hooks);
    for (const n of ['dec', 'inc', 'all']) expect(html).toContain(`data-sx="${n}"`);
    expect(html).toContain('data-n="10"');
  });

  it('НАЧИНКА ВИДНА В СТРОКЕ: иначе два одинаковых имени неразличимы', () => {
    const html = splitDialogHtml(
      модель('f1', [
        { unit: 'fighter', count: 5, modules: ['battery'] },
        { unit: 'fighter', count: 2 },
      ]),
      hooks,
    );
    expect(html).toContain('мод:battery');
  });

  it('НА НУЛЕ УВОДА «−1» ЗАПЕРТА, НА ПОЛНОМ — ВСЕ ПРИБАВКИ', () => {
    const units = [{ unit: 'f', count: 3 }];
    const key = splitSlots(units)[0]!.key;
    const ноль = splitDialogHtml(модель('f1', units), hooks);
    expect(ноль).toMatch(/data-sx="dec"[^>]*disabled/);
    const всё = splitDialogHtml(модель('f1', units, { [key]: 3 }), hooks);
    expect(всё).toMatch(/data-sx="inc"[^>]*data-n="1"[^>]*disabled/);
    expect(всё).toMatch(/data-sx="all"[^>]*disabled/);
  });

  it('ПОДТВЕРЖДЕНИЕ ЗАПЕРТО НА НУЛЕ И НА ПОЛНОМ УВОДЕ: ни то ни другое не деление', () => {
    const units = [{ unit: 'f', count: 3 }];
    const key = splitSlots(units)[0]!.key;
    expect(splitDialogHtml(модель('f1', units), hooks)).toMatch(/data-sx="confirm"[^>]*disabled/);
    expect(splitDialogHtml(модель('f1', units, { [key]: 3 }), hooks)).toMatch(
      /data-sx="confirm"[^>]*disabled/,
    );
    expect(splitDialogHtml(модель('f1', units, { [key]: 1 }), hooks)).not.toMatch(
      /data-sx="confirm"[^>]*disabled/,
    );
  });

  it('ПЕРЕГРУЗ ЗАПИРАЕТ ПОДТВЕРЖДЕНИЕ: десант, который некому везти, виден до отправки', () => {
    const units = [{ unit: 'hauler', count: 2 }];
    const landing = [{ unit: 'tank', count: 2 }];
    const slots = splitSlots(units, landing);
    const [ships, troops] = [slots[0]!.key, slots[1]!.key];
    const take = { [ships]: 1, [troops]: 2 }; // один корпус везёт одного, а грузят двоих
    const cargo = cargoSplit(slots, take, () => 1, () => 1);
    const html = splitDialogHtml(
      { fleetId: 'f1', rows: splitRows(slots, take), cargo },
      hooks,
    );
    expect(html).toMatch(/data-sx="confirm"[^>]*disabled/);
  });

  it('имя флота и имена юнитов экранируются — они попадают в разметку', () => {
    const html = splitDialogHtml(модель('<hack>', [{ unit: '<u>', count: 1 }]), {
      icon: () => '',
      name: (u) => u,
      moduleName: (m) => m,
    });
    expect(html).not.toContain('<hack>');
    expect(html).toContain('&lt;hack&gt;');
    expect(html).not.toContain('<u>');
  });
});
