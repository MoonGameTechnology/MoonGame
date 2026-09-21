import { describe, it, expect } from 'vitest';
import { parseGameData, SIGNAL_COUNTERS, type GameData } from '../data/schemas';
import { effectiveStats } from '../util/loadout';
import { loadGameData } from '../data/loadGameData';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SZE-4.2 — уровень усиливает ответ ТОЛЬКО против того сигнала, который его вызвал.
// Без этого правила прокачанный Рой становится всезнающим, а §3.4 требует обратного:
// контригра против памяти существует ровно потому, что специализация имеет цену.

const base = {
  version: '0.1.0',
  resources: ['biomass', 'metal', 'microelectronics'],
  units: {
    mother: {
      faction: 'swarm',
      traits: ['brood_host'],
      slots: { defense: 1, utility: 2 },
      stats: { attack: 12, defense: 14, speed: 40, hp: 60 },
    },
  },
  technologies: {},
  factions: { swarm: { name: 'Swarm' } },
  buildings: {},
  events: {},
  modes: {},
  sectorZeroStars: {
    cap: 5,
    guaranteed: 3,
    steps: [
      { chance: 1, warrants: 20, bonus: 0.1, pity: 0 },
      { chance: 1, warrants: 45, bonus: 0.1, pity: 0 },
      { chance: 1, warrants: 90, bonus: 0.15, pity: 0 },
    ],
  },
};

const ladder = {
  signal: 'strike',
  levels: [{ cost: { biomass: 30 }, hours: 6 }],
};

const withModules = (modules: Record<string, unknown>) => ({ ...base, modules });

describe('SZE-4.2 — данные не пропускают ответ, усиливающий не своё', () => {
  it('модуль-ответ с контр-характеристикой принимается', () => {
    const ok = () =>
      parseGameData(
        withModules({
          veil: {
            name: 'Veil',
            slot: 'defense',
            tag: 'vertical',
            effects: { stats: { pointDefense: 6 } },
            adaptation: ladder,
          },
        }),
      );
    expect(ok).not.toThrow();
  });

  it('модуль-ответ с ОБЩЕЙ боевой характеристикой отклоняется', () => {
    const bad = () =>
      parseGameData(
        withModules({
          veil: {
            name: 'Veil',
            slot: 'defense',
            tag: 'vertical',
            // `attack` не контрит ударный вылет — он усиливает Рой против ВСЕХ.
            effects: { stats: { pointDefense: 6, attack: 5 } },
            adaptation: ladder,
          },
        }),
      );
    expect(bad).toThrow();
  });

  it('и с обычной защитой тоже: она помогает против группы без ударных машин', () => {
    const bad = () =>
      parseGameData(
        withModules({
          veil: {
            name: 'Veil',
            slot: 'defense',
            tag: 'vertical',
            effects: { stats: { defense: 4 } },
            adaptation: ladder,
          },
        }),
      );
    expect(bad).toThrow();
  });

  it('неизвестный класс сигнала отклоняется — иначе запрет обходится опечаткой', () => {
    const bad = () =>
      parseGameData(
        withModules({
          veil: {
            name: 'Veil',
            slot: 'defense',
            tag: 'vertical',
            effects: { stats: { attack: 9 } },
            adaptation: { ...ladder, signal: 'страйк' },
          },
        }),
      );
    expect(bad).toThrow();
  });

  it('модуль БЕЗ лестницы правилом не связан — оно про ответы, а не про все модули', () => {
    const ok = () =>
      parseGameData(
        withModules({
          gun: { name: 'Gun', slot: 'weapon', tag: 'vertical', effects: { stats: { attack: 4 } } },
        }),
      );
    expect(ok).not.toThrow();
  });
});

describe('SZE-4.2 — уровень не помогает против группы без ударных машин', () => {
  const data: GameData = parseGameData(
    withModules({
      veil: {
        name: 'Veil',
        slot: 'defense',
        tag: 'vertical',
        effects: { stats: { pointDefense: 6 } },
        adaptation: ladder,
      },
    }),
  );
  const hull = data.units.mother!;

  it('поднятый уровень меняет ТОЛЬКО перехват', () => {
    const flat = effectiveStats(hull, { modules: ['veil'], moduleStars: { veil: 0 } }, data);
    const top = effectiveStats(hull, { modules: ['veil'], moduleStars: { veil: 3 } }, data);
    expect(top.pointDefense).toBeGreaterThan(flat.pointDefense!);
    // Всё, чем Рой бьёт и держится в обычном бою, обязано остаться тем же.
    for (const stat of ['attack', 'defense', 'hp', 'speed'] as const) {
      expect(top[stat]).toBe(flat[stat]);
    }
  });

  it('бой без ударных машин идёт по тем же числам на ★0 и ★3', () => {
    // Драка решается attack/defense/hp — их звезда покрова не трогает, значит исход
    // группы, у которой ударных машин нет, от уровня Роя не зависит вовсе.
    const flat = effectiveStats(hull, { modules: ['veil'] }, data);
    const top = effectiveStats(hull, { modules: ['veil'], moduleStars: { veil: 3 } }, data);
    const combat = (s: Record<string, number>) => [s.attack, s.defense, s.hp];
    expect(combat(top)).toEqual(combat(flat));
  });
});

describe('SZE-4.2 — правило держит и шипнутый каталог', () => {
  it('каждый модуль-ответ в данных игры несёт только свои контр-характеристики', () => {
    // Путь от модуля, а не от cwd: сторож обязан читать шипнутый каталог откуда
    // угодно, иначе он молча зелёный при запуске из другой папки.
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const shipped = loadGameData((name) =>
      JSON.parse(readFileSync(path.join(root, 'data', name), 'utf8')),
    );
    const offenders: string[] = [];
    for (const [id, m] of Object.entries(shipped.modules)) {
      const signal = m.adaptation?.signal;
      if (!signal) continue;
      const allowed = SIGNAL_COUNTERS[signal] ?? [];
      for (const stat of Object.keys(m.effects.stats)) {
        if (!allowed.includes(stat)) offenders.push(`${id}: ${stat}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
