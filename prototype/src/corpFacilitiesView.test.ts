import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { corpShowcaseHtml, parseWarehouse, warehouseHtml } from './corpFacilitiesView';
import { parseCorpRecord, parseReadyPool } from './corp';

beforeAll(() => setLocale('ru'));
describe('shared corporation facilities', () => {
  it('reads the same public server selection and monument in records and ready entries', () => {
    const corp = { corpId: 'c', name: 'Company', influence: 3, warehouseItems: 4, showcaseSlots: 10, showcase: ['ava_first_victory'], monument: true };
    expect(parseCorpRecord(corp)).toEqual(corp);
    expect(parseReadyPool([{ ...corp, members: 3, readySince: 1 }])[0]).toMatchObject(corp);
    expect(corpShowcaseHtml(corp)).toContain('Первая кровь');
    expect(corpShowcaseHtml(corp)).not.toContain('data-corpact');
  });
  it('only offers eligible awards to the head and shows the actual capacity', () => {
    const html = corpShowcaseHtml({ showcaseSlots: 20, showcase: ['ava_first_victory'] }, ['ava_first_victory'], true);
    expect(html).toContain('Размещено 1 из 20');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/data-corparg="ava_champion_5"[^>]* disabled/);
  });
  it('fails closed on bad warehouse records and disables loans at the shared limit', () => {
    expect(parseWarehouse({ capacity: 200, used: 0, canLend: true, fighters: [], items: [] })).toBeNull();
    const view = parseWarehouse({ capacity: 2, used: 2, canLend: true, fighters: [{ accountId: 'f', login: '<fighter>' }], items: [{ itemId: 'i', defId: 'cruiser', kind: 'hull', durability: 5, busy: false, borrower: null }] });
    expect(view).not.toBeNull();
    const html = warehouseHtml(view, [{ id: 'w', name: '<enemy>' }], 'w', 'f', false);
    expect(html).toMatch(/data-corpact="rent-item"[^>]* disabled/);
    expect(html).toContain('&lt;fighter&gt;');
    expect(html).not.toContain('<enemy>');
    expect(warehouseHtml(null, [], '', '', false)).toContain('Не удалось загрузить склад');
  });
});
