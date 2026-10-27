import { describe, expect, it } from 'vitest';
import type { MetaStoreOfferView } from '../packages/protocol/src/metaEconomyView';
import { corpStyleCard, parseCorpStyle, styleOfferState } from './corpStyle';

const view = (head: boolean, active = 'standard', owned: string[] = ['high_tech']) => ({
  head,
  active,
  owned,
});
const offer = (corpStyle: string): MetaStoreOfferView => ({
  id: `corp_style_${corpStyle}`,
  category: 'styles',
  price: 490,
  corpStyle,
  bought: 0,
});

describe('стиль базы корпорации (CORP-14)', () => {
  it('разбирает ответ сервера, а непонятный ответ не выдаёт за «нет корпорации»', () => {
    expect(parseCorpStyle({ corp: null })).toBeNull();
    expect(parseCorpStyle({ corp: view(true) })).toEqual(view(true));
    for (const raw of [
      null,
      {},
      { corp: { head: 'yes', active: 'standard', owned: [] } },
      { corp: { head: true, active: 'standard', owned: [1] } },
      { corp: { head: true, owned: [] } },
    ])
      expect(parseCorpStyle(raw)).toBeUndefined();
  });

  it('карточка на вкладке «Корпорация»: глава применяет и идёт в магазин, остальные смотрят', () => {
    const head = view(true, 'high_tech');
    expect(corpStyleCard(head, 'high_tech')).toBe('applied');
    // Стандартный стиль есть у каждой корпорации, покупать его не нужно.
    expect(corpStyleCard(head, 'standard')).toBe('apply');
    expect(corpStyleCard(head, 'imperial_gothic')).toBe('shop');
    const member = view(false, 'high_tech');
    expect(corpStyleCard(member, 'high_tech')).toBe('applied');
    expect(corpStyleCard(member, 'standard')).toBe('owned');
    expect(corpStyleCard(member, 'imperial_gothic')).toBe('locked');
  });

  it('кнопка в магазине не обещает того, что сервер отклонит', () => {
    const gothic = offer('imperial_gothic');
    expect(styleOfferState(gothic, undefined, 9999)).toEqual({
      kind: 'blocked',
      reason: 'offline',
    });
    expect(styleOfferState(gothic, null, 9999)).toEqual({ kind: 'blocked', reason: 'corp' });
    expect(styleOfferState(gothic, view(false), 9999)).toEqual({
      kind: 'blocked',
      reason: 'head',
    });
    expect(styleOfferState(gothic, view(true), 100)).toEqual({ kind: 'short', lack: 390 });
    expect(styleOfferState(gothic, view(true), 490)).toEqual({ kind: 'buy' });
    const tech = offer('high_tech');
    expect(styleOfferState(tech, view(true), 0)).toEqual({ kind: 'apply' });
    expect(styleOfferState(tech, view(false), 0)).toEqual({ kind: 'blocked', reason: 'owned' });
    expect(styleOfferState(tech, view(false, 'high_tech'), 0)).toEqual({ kind: 'applied' });
  });
});
