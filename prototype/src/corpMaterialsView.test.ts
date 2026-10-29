import { expect, it } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import { canFundCorpBuilding, corpMaterialsHtml, parseCorpMaterials } from './corpMaterialsView';
import { corpHubSheetHtml, type CorpHubPaint } from './corpHubView';
import { updateCorpInfrastructure } from '../../packages/server/src/corpConstruction';
import type { CorpMaterialsView } from '../../packages/protocol/src/corpInfrastructure';
const bank = (): CorpMaterialsView => ({
  corpId: 'c1',
  pending: false,
  history: [],
  materials: ['construction_blocks', 'engineering_kits', 'command_cores'].map((id) => ({
    id,
    nameKey: 'meta.material.' + id,
    personal: 10,
    available: 10,
    reserved: 0,
  })),
});
it('malformed and unavailable private stock never enables a material-priced order', () => {
  const result = updateCorpInfrastructure(
    'c1',
    'a1',
    'head',
    1000,
    { levels: { headquarters: 1 }, construction: null, accruedAt: 0, remainder: 0 },
    0,
  ).result;
  if (!result.ok) throw Error('fixture');
  const next = result.infrastructure.buildings.find((b) => b.id === 'supply_center')!.next!;
  expect(canFundCorpBuilding(next, bank())).toBe(true);
  for (const value of [null, { ...bank(), pending: true }, { ...bank(), materials: [] }])
    expect(canFundCorpBuilding(next, value)).toBe(false);
  expect(canFundCorpBuilding({ ...next, price: undefined }, bank())).toBe(false);
  for (const value of [
    {},
    { corp: { ...bank(), materials: [] } },
    {
      corp: {
        ...bank(),
        materials: [bank().materials[0], bank().materials[0], bank().materials[2]],
      },
    },
  ])
    expect(parseCorpMaterials(value)).toBeNull();
  expect(parseCorpMaterials({ corp: bank() })).toEqual(bank());
});
it('treasury contributions and building price explain stocks in both languages without markup injection', () => {
  const result = updateCorpInfrastructure(
    'c1',
    'a1',
    'head',
    1000,
    { levels: { headquarters: 1 }, construction: null, accruedAt: 0, remainder: 0 },
    0,
  ).result;
  if (!result.ok) throw Error('fixture');
  for (const locale of ['ru', 'en'] as const) {
    setLocale(locale);
    const html = corpMaterialsHtml(bank(), false);
    expect(html.match(/data-corpact="contribute"/g)).toHaveLength(3);
    expect(html).toContain(t('corp.materials.market'));
    expect(html).not.toContain('meta.material.');
    const paint = {
      view: result.infrastructure,
      materials: bank(),
      busy: false,
      elapsedMs: 0,
      facilities: {},
    } as CorpHubPaint;
    const sheet = corpHubSheetHtml(paint, { kind: 'building', id: 'supply_center' }, '');
    expect(sheet).toContain(t('corp.materials.cost'));
    expect(sheet).toContain(t('meta.material.construction_blocks'));
    expect(sheet).toMatch(/data-corpact="build"[^>]*data-corparg="supply_center">/);
    expect(
      corpHubSheetHtml({ ...paint, materials: null }, { kind: 'building', id: 'supply_center' }, ''),
    ).not.toContain('data-corpact="build"');
    expect(corpMaterialsHtml({ ...bank(), pending: true }, true)).toContain(
      t('corp.materials.pending'),
    );
  }
});
