import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setLocale, t } from '../../localization/runtime';
import { shippedGameData } from '../../data/bundle';
import { shipCardModel } from '../../decisions/shipCard';
import { shipCardHtml, type ShipCardHooks } from './shipCard';

beforeAll(() => setLocale('ru'));

const data = shippedGameData();
const hooks: ShipCardHooks = {
  portrait: () => '',
  icon: () => '<i>ico</i>',
  unitName: (u) => `name:${u}`,
  moduleName: (m) => `mod:${m}`,
};
const card = (stack: Parameters<typeof shipCardModel>[0], hp = 100, fleetName?: string) =>
  shipCardHtml(shipCardModel(stack, data)!, hooks, { hpPct: hp, ...(fleetName ? { fleetName } : {}) });

describe('карточка корабля — разметка (заказ владельца 2026-09-24)', () => {
  it('надетый модуль виден: значок, имя, звёзды, редкость и что он даёт', () => {
    const html = card({
      unit: 'cruiser',
      count: 2,
      modules: ['targeting_array', 'shield_booster'],
      moduleStars: { targeting_array: 2 },
      moduleRarity: { shield_booster: 'legendary' },
    });
    expect(html).toContain('mod:targeting_array');
    expect(html).toContain('🎯');
    expect(html).toContain('★★');
    expect(html).toContain(t('rarity.legendary'));
    expect(html).toContain(`+15 ${t('loadout.stat.shield')}`);
    expect(html).toContain('name:cruiser <span class="sc-n">×2</span>');
    // Игроку — имена, а не id модулей.
    expect(html).not.toMatch(/>targeting_array</);
  });

  it('пустой отсек виден пустым, с типом слота', () => {
    const html = card({ unit: 'cruiser', count: 1 });
    expect(html.match(/class="cn-bay empty"/g)?.length).toBe(3);
    expect(html).toContain(t('shipcard.empty'));
    expect(html).toContain(t('shipcard.loadout', { n: 0, m: 3 }));
  });

  it('универсальный отсек подписан своим типом — модуль любого типа стоит в нём', () => {
    const html = card({ unit: 'heavy_cruiser', count: 1, modules: ['shield_booster'] });
    expect(html.match(/class="cn-bay empty"/g)?.length).toBe(3);
    expect(html).toContain(t('yard.slot.universal'));
    expect(html).toContain(t('shipcard.loadout', { n: 1, m: 4 }));
    expect(html).not.toContain('sc-extra');
  });

  it('модуль сверх ёмкости помечен', () => {
    const html = card({ unit: 'cruiser', count: 1, modules: ['shield_booster', 'ablative_plating'] });
    expect(html).toContain('sc-extra');
    expect(html).toContain(t('shipcard.extra'));
  });

  it('у корпуса без отсеков — так и сказано', () => {
    const noBays = Object.keys(data.units).find((id) => {
      const s = data.units[id]!.slots;
      return data.units[id]!.domain === 'space' && s.weapon + s.defense + s.utility === 0;
    });
    if (!noBays) return; // в данных сейчас нет такого корпуса — правило проверять не на ком
    expect(card({ unit: noBays, count: 1 })).toContain(t('shipcard.loadout.none'));
  });

  it('справочник корпуса — отдельной кнопкой; корпус стека в пределах 0–100', () => {
    const html = card({ unit: 'cruiser', count: 1 }, 140, 'Флот «A»');
    expect(html).toContain('data-codex="u:cruiser"');
    expect(html).toContain('<i style="width:100%"></i>');
    expect(html).toContain('Флот «A»');
    expect(card({ unit: 'cruiser', count: 1 }, 12)).toContain('sc-hpbar low');
  });
});

describe('карточка корабля — проводка', () => {
  // Сторож проводки: плитка корабля во флоте открывает карточку стека, а не справочник
  // корпуса, где про надетое не было ни слова. Наземные плитки остаются со справочником.
  it('плитка корабля ведёт в карточку, наземная — в справочник', () => {
    const main = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8');
    expect(main).toContain("def.domain === 'space' ? `data-shipcard=\"${esc(f.id)}|${index}\"` : `data-codex=\"u:${esc(u.unit)}\"`");
    expect(main).toMatch(/if \(bEl\.dataset\.shipcard\) \{[\s\S]{0,300}openShipCard\(/);
  });
});
