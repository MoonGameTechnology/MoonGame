import { describe, it, expect } from 'vitest';
import { splitDialogLives, splitRows, splitDialogHtml } from './splitDialog';

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
  it('СТРОКА НА ТИП: остаток и увод считаются от живого состава', () => {
    expect(splitRows({ fighter: 5, tanker: 2 }, { fighter: 2 })).toEqual([
      { unit: 'fighter', have: 5, take: 2, stay: 3 },
      { unit: 'tanker', have: 2, take: 0, stay: 2 },
    ]);
  });

  it('порядок типов сохраняется — строки не прыгают между перерисовками', () => {
    const rows = splitRows({ b: 1, a: 1, c: 1 }, {});
    expect(rows.map((r) => r.unit)).toEqual(['b', 'a', 'c']);
  });

  it('пустой состав — пустой список строк, а не строка с нулями', () => {
    expect(splitRows({}, {})).toEqual([]);
  });
});

describe('окно деления — разметка', () => {
  const hooks = { icon: (u: string) => `<i>${u}</i>`, name: (u: string) => `имя:${u}` };

  it('у каждой строки все четыре шага увода', () => {
    const html = splitDialogHtml({ fleetId: 'f1', rows: splitRows({ fighter: 5 }, {}) }, hooks);
    for (const n of ['dec', 'inc', 'all']) expect(html).toContain(`data-sx="${n}"`);
    expect(html).toContain('data-n="10"');
  });

  it('НА НУЛЕ УВОДА «−1» ЗАПЕРТА, НА ПОЛНОМ — ВСЕ ПРИБАВКИ', () => {
    const пусто = splitDialogHtml({ fleetId: 'f1', rows: splitRows({ f: 3 }, {}) }, hooks);
    expect(пусто).toMatch(/data-sx="dec"[^>]*disabled/);
    const всё = splitDialogHtml({ fleetId: 'f1', rows: splitRows({ f: 3 }, { f: 3 }) }, hooks);
    expect(всё).toMatch(/data-sx="inc"[^>]*data-n="1"[^>]*disabled/);
    expect(всё).toMatch(/data-sx="all"[^>]*disabled/);
  });

  it('ПОДТВЕРЖДЕНИЕ ЗАПЕРТО НА НУЛЕ И НА ПОЛНОМ УВОДЕ: ни то ни другое не деление', () => {
    const ноль = splitDialogHtml({ fleetId: 'f1', rows: splitRows({ f: 3 }, {}) }, hooks);
    expect(ноль).toMatch(/data-sx="confirm"[^>]*disabled/);
    const всё = splitDialogHtml({ fleetId: 'f1', rows: splitRows({ f: 3 }, { f: 3 }) }, hooks);
    expect(всё).toMatch(/data-sx="confirm"[^>]*disabled/);
    const часть = splitDialogHtml({ fleetId: 'f1', rows: splitRows({ f: 3 }, { f: 1 }) }, hooks);
    expect(часть).not.toMatch(/data-sx="confirm"[^>]*disabled/);
  });

  it('имя флота и имена юнитов экранируются — они попадают в разметку', () => {
    const html = splitDialogHtml(
      { fleetId: '<hack>', rows: splitRows({ '<u>': 1 }, {}) },
      { icon: () => '', name: (u) => u },
    );
    expect(html).not.toContain('<hack>');
    expect(html).toContain('&lt;hack&gt;');
    expect(html).not.toContain('<u>');
  });
});
