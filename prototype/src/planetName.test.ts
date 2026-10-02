import { beforeAll, describe, expect, it } from 'vitest';
import type { GameState } from '../../packages/shared-core/src/index';
import { setLocale, t } from '../../localization/runtime';
import { mapPreset } from './mapCatalog';
import { newGame } from './matchSetup';
import { PLANET_NAMES, mapWorldName, planetName, worldName, worldNames } from './planetName';

describe('planetName — детерминированное имя мира из координаты', () => {
  it('один id → одно и то же имя (стабильно между вызовами/клиентами)', () => {
    expect(planetName('C2R1')).toBe(planetName('C2R1'));
    expect(planetName('C8R9')).toBe(planetName('C8R9'));
  });

  it('формат «{ИМЯ из пула}-{N=1..9}»', () => {
    for (const id of ['C2R1', 'C5R1', 'C1R7', 'x', 'cell-42']) {
      const nm = planetName(id);
      const m = /^([A-Z]+)-([1-9])$/.exec(nm);
      expect(m, `bad name ${nm}`).not.toBeNull();
      expect(PLANET_NAMES).toContain(m![1]);
    }
  });

  it('разные координаты дают разброс имён (не все одинаковые)', () => {
    const names = new Set(
      Array.from({ length: 50 }, (_, i) => planetName(`C${i % 9}R${Math.floor(i / 9)}`)),
    );
    expect(names.size).toBeGreaterThan(12);
  });
});

describe('worldNames — у мира карты своё имя (UIX-5.2)', () => {
  const ids = (mapId: 'nexus' | 'frontier-50') => mapPreset(mapId).nodes.map((n) => n.id);

  it.each(['nexus', 'frontier-50'] as const)('на карте %s имена не повторяются', (mapId) => {
    const names = worldNames(ids(mapId));
    expect(names.size).toBe(ids(mapId).length);
    expect(new Set(names.values()).size).toBe(names.size);
  });

  it('хэш на «Нексусе» повторялся — номер различает миры, имя остаётся', () => {
    // Сторож предпосылки: без таблицы «STYX-3» стоял и на C0R2, и на C2R4.
    expect(planetName('C0R2')).toBe(planetName('C2R4'));
    const names = worldNames(ids('nexus'));
    expect(names.get('C0R2')).toBe('STYX-3'); // первый по id оставляет имя хэша
    expect(names.get('C2R4')).toMatch(/^STYX-\d+$/);
    expect(names.get('C2R4')).not.toBe('STYX-3');
  });

  it('мир без совпадения хэша сохраняет прежнее имя', () => {
    const all = ids('nexus');
    const byHash = new Map<string, number>();
    for (const id of all) byHash.set(planetName(id), (byHash.get(planetName(id)) ?? 0) + 1);
    const names = worldNames(all);
    for (const id of all) if (byHash.get(planetName(id)) === 1) expect(names.get(id)).toBe(planetName(id));
  });

  it('порядок миров на входе имён не меняет — у карты одна таблица на всех клиентах', () => {
    const all = ids('nexus');
    expect([...worldNames([...all].reverse())].sort()).toEqual([...worldNames(all)].sort());
  });

  it('на фронтире миров больше, чем имён с номером до 9, — номера идут дальше', () => {
    const names = [...worldNames(ids('frontier-50')).values()];
    expect(names.some((n) => Number(n.split('-')[1]) > 9)).toBe(true);
    for (const n of names) expect(n).toMatch(/^[A-Z]+-\d+$/);
  });
});

describe('worldName — одно имя на подписи, журнал и окна (UIX-5.2)', () => {
  beforeAll(() => setLocale('ru'));

  it('на карте без имён — авто-имя из таблицы карты, а не код', () => {
    const s = newGame();
    const names = worldNames(Object.keys(s.planets));
    expect(worldName(s, 'C2R4')).toBe(names.get('C2R4'));
    expect(worldName(s, 'C2R4')).not.toBe('C2R4');
  });

  it('настройка матча называет мир так же, как потом партия', () => {
    const s = newGame();
    const nodes = mapPreset('nexus').nodes;
    for (const n of nodes) expect(mapWorldName('nexus', nodes, n.id)).toBe(worldName(s, n.id));
  });

  it('у провинции главы — её имя', () => {
    const s = { mapId: 'pve-1', planets: { home_a: {} } } as unknown as GameState;
    expect(worldName(s, 'home_a')).toBe(t('province.pve-1.home-a'));
  });

  it('крепость на развилке названа по своей провинции и номер не занимает', () => {
    const s = newGame();
    const before = worldName(s, 'C2R4');
    const site = { ...s.planets.C0R2!, id: 'fork-C0R2-0', fork: { province: 'C0R2', trail: 0 } };
    const withFort = { ...s, planets: { ...s.planets, [site.id]: site } } as GameState;
    expect(worldName(withFort, site.id)).toBe(
      t('place.fork-fortress', { planet: worldName(withFort, 'C0R2') }),
    );
    expect(worldName(withFort, 'C2R4')).toBe(before);
  });

  it('узла нет на карте — остаётся его id, а не выдуманное имя', () => {
    expect(worldName(newGame(), 'N7')).toBe('N7');
  });
});
