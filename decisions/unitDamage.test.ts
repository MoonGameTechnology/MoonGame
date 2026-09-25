import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeGameDataBundle } from '../packages/shared-core/src/data/loadGameData';
import { effectiveStats, parseGameData, type GameData } from '../packages/shared-core/src/index';
import { DAMAGE_TARGETS, DAMAGE_TARGET_KEY, unitDamageProfile } from './unitDamage';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const data: GameData = parseGameData(
  composeGameDataBundle((name) => JSON.parse(readFileSync(path.join(dataDir, name), 'utf8'))),
);

const profile = (unit: string): Record<string, number> => {
  const def = data.units[unit]!;
  return Object.fromEntries(unitDamageProfile(def, def.stats).map((r) => [r.target, r.value]));
};

describe('урон юнита по целям', () => {
  it('корабль: атака по кораблям, половина её по зданиям, ПРО по авиации, по земле — ничего', () => {
    const st = data.units.cruiser!.stats;
    expect(profile('cruiser')).toEqual({
      ships: st.attack,
      buildings: st.attack * 0.5,
      air: st.pointDefense ?? 0,
      vehicles: 0,
      infantry: 0,
    });
  });

  it('осадный урон корабля заменяет долю атаки по зданиям', () => {
    const def = data.units.cruiser!;
    const row = unitDamageProfile(def, { ...def.stats, siegeDamage: 40 }).find(
      (r) => r.target === 'buildings',
    );
    expect(row?.value).toBe(40);
  });

  it('шаттл: бомбардировщик бьёт здания осадным уроном, перехватчик — авиацию', () => {
    const bomber = data.units.bomber!.stats;
    expect(profile('bomber').buildings).toBe(bomber.siegeDamage);
    expect(profile('bomber').ships).toBe(bomber.attack);
    expect(profile('interceptor').air).toBe(data.units.interceptor!.stats.shuttleDamage);
    expect(profile('interceptor').vehicles).toBe(0);
  });

  it('шаттл без осадного урона бьёт мир полной атакой', () => {
    const def = data.units.bomber!;
    const row = unitDamageProfile(def, { ...def.stats, siegeDamage: 0 }).find(
      (r) => r.target === 'buildings',
    );
    expect(row?.value).toBe(def.stats.attack);
  });

  it('наземный: ПВО по кораблям, урон по зданиям, атака одинаково по технике и пехоте', () => {
    const tank = data.units.tank!.stats;
    expect(profile('tank')).toEqual({
      ships: tank.aaDamage ?? 0,
      buildings: tank.buildingDamage,
      air: 0,
      vehicles: tank.attack,
      infantry: tank.attack,
    });
  });

  it('оснащение доходит до профиля: модуль ПРО виден в уроне по авиации', () => {
    const pdModule = Object.entries(data.modules).find(
      ([, m]) => (m.effects?.stats?.pointDefense ?? 0) > 0,
    );
    expect(pdModule).toBeDefined();
    const [id] = pdModule!;
    const hull = Object.entries(data.units).find(
      ([, u]) =>
        u.domain !== 'ground' &&
        !u.traits.includes('shuttle') &&
        (u.slots?.[data.modules[id]!.slot] ?? 0) > 0,
    );
    expect(hull).toBeDefined();
    const [, def] = hull!;
    const eff = effectiveStats(def, { modules: [id] }, data);
    const air = unitDamageProfile(def, eff).find((r) => r.target === 'air')!.value;
    expect(air).toBeGreaterThan(def.stats.pointDefense ?? 0);
  });

  it('пять строк у каждого юнита каталога, у каждой есть подпись', () => {
    for (const def of Object.values(data.units)) {
      const rows = unitDamageProfile(def, def.stats);
      expect(rows.map((r) => r.target)).toEqual(DAMAGE_TARGETS);
      for (const r of rows) expect(r.value).toBeGreaterThanOrEqual(0);
    }
    for (const target of DAMAGE_TARGETS) expect(DAMAGE_TARGET_KEY[target]).toMatch(/^codex\.dmg\./);
  });
});
