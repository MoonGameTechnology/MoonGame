import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import {
  MAX_TEMPLATES,
  MAX_TEMPLATE_NAME,
  addTemplate,
  fitTemplate,
  parseTemplates,
  removeTemplate,
  type BuildTemplate,
} from './buildTemplates';

const data = shippedGameData();
const TABS = ['ships', 'support', 'squads', 'infantry', 'vehicles'];
const cruiser: BuildTemplate = {
  tab: 'ships',
  hull: 'cruiser',
  modules: ['targeting_array', 'cargo_bay'],
  count: 3,
};

describe('шаблоны заказа', () => {
  it('переживают запись и чтение', () => {
    const raw = JSON.stringify([cruiser]);
    expect(parseTemplates(raw, data, TABS)).toEqual([cruiser]);
  });

  it('мусор в хранилище не роняет окно', () => {
    expect(parseTemplates(null, data, TABS)).toEqual([]);
    expect(parseTemplates('{', data, TABS)).toEqual([]);
    expect(parseTemplates('{"a":1}', data, TABS)).toEqual([]);
    const raw = JSON.stringify([
      null,
      { tab: 'heroes', hull: 'cruiser', modules: [], count: 1 }, // вкладки шаблонов нет
      { tab: 'ships', hull: 'death_star', modules: [], count: 1 }, // корпуса нет в данных
      { tab: 'ships', hull: 'cruiser', modules: ['nope', 'cargo_bay', 7], count: 999 },
      { tab: 'ships', hull: 'frigate', modules: 'x', count: 'x', troop: 'nobody' },
    ]);
    expect(parseTemplates(raw, data, TABS)).toEqual([
      { tab: 'ships', hull: 'cruiser', modules: ['cargo_bay'], count: 20 },
      { tab: 'ships', hull: 'frigate', modules: [], count: 1 },
    ]);
  });

  it('держит не больше предела и без дублей', () => {
    const many = Array.from({ length: MAX_TEMPLATES + 5 }, (_, i) => ({
      ...cruiser,
      count: (i % 20) + 1,
    }));
    expect(parseTemplates(JSON.stringify(many), data, TABS)).toHaveLength(MAX_TEMPLATES);
    expect(parseTemplates(JSON.stringify([cruiser, cruiser]), data, TABS)).toHaveLength(1);
  });

  it('новый встаёт первым, дубль и переполнение отбиваются', () => {
    const frigate: BuildTemplate = { tab: 'ships', hull: 'frigate', modules: [], count: 1 };
    const r = addTemplate([cruiser], frigate);
    expect(r).toEqual({ ok: true, list: [frigate, cruiser] });
    expect(addTemplate([cruiser], { ...cruiser, modules: [...cruiser.modules] })).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    const full = Array.from({ length: MAX_TEMPLATES }, (_, i) => ({ ...cruiser, count: i + 1 }));
    expect(addTemplate(full, frigate)).toEqual({ ok: false, reason: 'full' });
    expect(removeTemplate([frigate, cruiser], 0)).toEqual([cruiser]);
  });

  it('на постановке сводится к тому, что можно заказать сейчас', () => {
    const roster = ['cruiser', 'frigate', 'scout'];
    expect(fitTemplate(cruiser, roster, data)).toEqual(cruiser);
    // Корпуса нет во вкладке или в арсенале партии — шаблон не ставится.
    expect(fitTemplate(cruiser, ['frigate'], data)).toBeNull();
    expect(fitTemplate(cruiser, roster, data, { hulls: ['frigate'], modules: [] })).toBeNull();
    // Модуля нет в арсенале — он отпадает, остальное остаётся.
    expect(
      fitTemplate(cruiser, roster, data, { hulls: ['cruiser'], modules: ['targeting_array'] }),
    ).toEqual({ ...cruiser, modules: ['targeting_array'] });
    // Правило данных запрещает модуль корпусу (разведчику — грузовой отсек).
    const scout: BuildTemplate = { tab: 'ships', hull: 'scout', modules: ['cargo_bay'], count: 1 };
    expect(fitTemplate(scout, roster, data)).toEqual({ ...scout, modules: [] });
  });

  it('сохраняет старые шаблоны и нормализует новые имена при чтении', () => {
    const named = { ...cruiser, count: 2, name: '\n Patrol\u0000 ' };
    expect(
      parseTemplates(
        JSON.stringify([cruiser, named, { ...named, count: 4, name: 'PATROL' }]),
        data,
        TABS,
      ),
    ).toEqual([cruiser, { ...named, name: 'Patrol' }]);
    const long = addTemplate([], { ...cruiser, name: 'a'.repeat(80) });
    expect(long.ok && long.list[0]!.name).toHaveLength(MAX_TEMPLATE_NAME);
  });

  it('не допускает пустые имена, совпадение имён и копии сборки под другим именем', () => {
    const named = { ...cruiser, modules: [...cruiser.modules], name: 'Patrol' };
    expect(addTemplate([], { ...cruiser, name: '\n ' })).toEqual({ ok: false, reason: 'name' });
    expect(addTemplate([named], { ...named, count: 2, name: ' patrol ' })).toEqual({
      ok: false,
      reason: 'name',
    });
    expect(addTemplate([named], { ...named, name: 'Escort' })).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    const result = addTemplate([], named);
    named.modules.push('cargo_bay');
    expect(result.ok && result.list[0]!.modules).toEqual(cruiser.modules);
  });
});
