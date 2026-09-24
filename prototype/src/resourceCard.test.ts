import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { setLocale } from '../../localization/runtime';
import { createInitialState } from '../../packages/shared-core/src/index';
import { resourceCardHtml, type CardSupply } from './resourceCard';

beforeAll(() => setLocale('ru'));

const state = {
  ...createInitialState({ seed: 'rc', version: { data: '0.1.0', manifest: '1' } }),
  players: { p1: { id: 'p1', name: 'p1', faction: 'azure', status: 'active', resources: { metal: 400 } } },
} as unknown as Parameters<typeof resourceCardHtml>[0];
const supply = (over: Partial<CardSupply> = {}): CardSupply => ({
  pack: { credits: 150, metal: 150, food: 100, energy: 50 },
  price: 5,
  left: 3,
  perRun: 3,
  affordable: true,
  ...over,
});
const card = (s: CardSupply | null) => resourceCardHtml(state, 'p1', 'metal', {}, false, s);

describe('карточка ресурса — пакет снабжения (решение владельца 2026-09-24)', () => {
  it('нет пакета — нет и блока', () => {
    expect(card(null)).not.toContain('data-rc-supply');
  });

  it('можно купить — кнопка с ценой, состав пакета и остаток на забег', () => {
    const html = card(supply({ left: 2 }));
    expect(html).toMatch(/<button class="rc-buy" data-rc-supply>Купить за 5 ◆<\/button>/);
    expect(html).toContain('Осталось 2 из 3 на экспедицию');
    expect(html).toContain('rc-credits');
    expect(html).toContain('+150');
  });

  it('не хватает Суверенов — кнопка погашена, цена и причина видны', () => {
    const html = card(supply({ affordable: false }));
    expect(html).toContain('data-rc-supply disabled');
    expect(html).toContain('Нужно 5 ◆ — Суверенов не хватает');
  });

  it('лимит забега исчерпан — кнопка погашена', () => {
    const html = card(supply({ left: 0 }));
    expect(html).toContain('data-rc-supply disabled');
    expect(html).toContain('Снабжение на эту экспедицию исчерпано');
  });
});

describe('снабжение — проводка у хоста', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('  onBuySupply: () => {'));
  const fn = body.slice(0, body.indexOf('\n  },\n') + 5);

  it('сперва проверка оплаты, потом ядро, списание — только если ядро выдало пакет', () => {
    const check = fn.indexOf("changeSectorZeroProgress(sectorProgress, { kind: 'run-supply' }, data)");
    const order = fn.indexOf('if (playerOrder(buySupply(ME))) {');
    const save = fn.indexOf('saveSectorProgress(paid);');
    expect(check).toBeGreaterThan(0);
    expect(order).toBeGreaterThan(check);
    expect(save).toBeGreaterThan(order);
    expect(fn.match(/saveSectorProgress\(/g)).toHaveLength(1);
  });
});
