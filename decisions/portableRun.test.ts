import { describe, expect, it } from 'vitest';
import {
  describeRun,
  parsePortableRun,
  serializePortableRun,
  PORTABLE_RUN_VERSION,
  type PortableRunSave,
  type RunFacts,
} from './portableRun';

const isBoon = (id: string): boolean => id.startsWith('boon_');

const facts = (waveNumber: number, completed: string[]): RunFacts => ({
  pve: { waveNumber },
  players: { p1: { technologies: { completed } } },
});

describe('YAG-2.1 — дескриптор описывает забег, а не мир', () => {
  it('берёт волну, сложность и ТОЛЬКО усиления из завершённых технологий', () => {
    const save = describeRun(
      facts(6, ['metallurgy', 'boon_shield', 'logistics', 'boon_swarm']),
      'p1',
      isBoon,
      { mode: 'pve', difficulty: 'hard', attempt: 12 },
    );
    expect(save).toEqual({
      v: PORTABLE_RUN_VERSION,
      mode: 'pve',
      difficulty: 'hard',
      wave: 6,
      attempt: 12,
      boons: ['boon_shield', 'boon_swarm'],
    });
  });

  it('порядок усилений — порядок ВЗЯТИЯ, а не алфавит', () => {
    const save = describeRun(facts(2, ['boon_swarm', 'boon_shield']), 'p1', isBoon, {
      mode: 'pve',
      difficulty: 'normal',
    });
    // Сортировка здесь была бы тихой потерей: усиления берут по одному за волну, и
    // порядок — это история забега, которую восстановление воспроизводит.
    expect(save.boons).toEqual(['boon_swarm', 'boon_shield']);
  });

  it('пустые поля не занимают места: нет усилений и попытки — нет ключей', () => {
    const save = describeRun(facts(0, ['metallurgy']), 'p1', isBoon, {
      mode: 'pve',
      difficulty: 'normal',
    });
    expect(save).toEqual({ v: PORTABLE_RUN_VERSION, mode: 'pve', difficulty: 'normal', wave: 0 });
  });

  it('чужое место и отсутствующая секция забега дают волну 0, а не исключение', () => {
    expect(describeRun({}, 'p1', isBoon, { mode: 'pve', difficulty: 'normal' }).wave).toBe(0);
    expect(
      describeRun(facts(3, ['boon_a']), 'p9', isBoon, { mode: 'pve', difficulty: 'normal' }).boons,
    ).toBeUndefined();
  });

  it('мусорная волна (дробная, отрицательная) читается как ноль', () => {
    const odd: RunFacts = { pve: { waveNumber: -4 } };
    expect(describeRun(odd, 'p1', isBoon, { mode: 'pve', difficulty: 'normal' }).wave).toBe(0);
  });
});

describe('YAG-2.1 — размер: ради него всё и затевалось', () => {
  it('забег с десятью усилениями — меньше 400 байт', () => {
    const boons = Array.from({ length: 10 }, (_, i) => `boon_deep_strike_variant_${i}`);
    const save = describeRun(facts(10, boons), 'p1', isBoon, {
      mode: 'pve',
      difficulty: 'nightmare',
      attempt: 9999,
    });
    const bytes = new TextEncoder().encode(serializePortableRun(save)).length;
    // Замер `yandex-games-roadmap.md` §2.1: состояние партии 29–31 КБ. Здесь — сотни
    // байт, то есть дело не в «влезет ли», а в том, что писать это можно часто.
    expect(bytes).toBeLessThan(400);
  });

  it('и это на два порядка меньше замеренного состояния (29 КБ)', () => {
    const save = describeRun(facts(6, ['boon_a', 'boon_b']), 'p1', isBoon, {
      mode: 'pve',
      difficulty: 'hard',
      attempt: 12,
    });
    const bytes = new TextEncoder().encode(serializePortableRun(save)).length;
    expect(bytes * 100).toBeLessThan(29 * 1024);
  });
});

describe('YAG-2.1 — разбор не доверяет ничему: снимок приезжает из чужого хранилища', () => {
  const good: PortableRunSave = {
    v: PORTABLE_RUN_VERSION,
    mode: 'pve',
    difficulty: 'hard',
    wave: 4,
    attempt: 3,
    boons: ['boon_a'],
  };

  it('круг «сериализовать → разобрать» возвращает то же самое', () => {
    expect(parsePortableRun(serializePortableRun(good))).toEqual(good);
  });

  for (const [name, raw] of [
    ['пусто', ''],
    ['null', null],
    ['не JSON', '{oops'],
    ['не объект', '42'],
    ['массив', '[]'],
    ['чужая версия', JSON.stringify({ ...good, v: 2 })],
    ['нет режима', JSON.stringify({ ...good, mode: '' })],
    ['режим не строка', JSON.stringify({ ...good, mode: 7 })],
    ['нет сложности', JSON.stringify({ ...good, difficulty: '' })],
    ['волна дробная', JSON.stringify({ ...good, wave: 1.5 })],
    ['волна отрицательная', JSON.stringify({ ...good, wave: -1 })],
    ['волна строкой', JSON.stringify({ ...good, wave: '4' })],
  ] as const)
    it(`${name} → «сохранения нет», а не полузабег`, () => {
      expect(parsePortableRun(raw)).toBeNull();
    });

  it('битое усиление теряет СЕБЯ, а не весь забег', () => {
    const save = parsePortableRun(JSON.stringify({ ...good, boons: ['boon_a', 7, '', 'boon_b'] }));
    expect(save?.boons).toEqual(['boon_a', 'boon_b']);
    expect(save?.wave).toBe(4);
  });

  it('дубли усилений схлопываются: ядро повторное всё равно не выдаст', () => {
    const save = parsePortableRun(JSON.stringify({ ...good, boons: ['boon_a', 'boon_a'] }));
    expect(save?.boons).toEqual(['boon_a']);
  });

  it('усиления не массив — забег живёт, усилений просто нет', () => {
    const save = parsePortableRun(JSON.stringify({ ...good, boons: 'boon_a' }));
    expect(save).not.toBeNull();
    expect(save?.boons).toBeUndefined();
  });

  it('мусорная попытка отбрасывается, забег остаётся', () => {
    for (const attempt of [0, -3, 1.5, 'x'])
      expect(parsePortableRun(JSON.stringify({ ...good, attempt }))?.attempt).toBeUndefined();
  });

  it('лишние поля не доезжают: разбор собирает снимок, а не копирует вход', () => {
    const save = parsePortableRun(JSON.stringify({ ...good, admin: true, state: { huge: 1 } }));
    expect(save).toEqual(good);
  });
});
