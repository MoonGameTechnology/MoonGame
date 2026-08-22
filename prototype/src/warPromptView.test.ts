import { describe, expect, it } from 'vitest';
import { warPromptText, warReason } from './warPromptView';

describe('повод запроса', () => {
  it('флаг штурма поднят — повод «штурм»', () => {
    expect(warReason(true)).toBe('assault');
  });

  it('флага нет — повод «транзит» (в том числе когда поле не задано)', () => {
    expect(warReason(false)).toBe('transit');
    expect(warReason(undefined)).toBe('transit');
  });
});

describe('что написано в запросе', () => {
  it('ШТУРМ: «это мир дружественной фракции» и прямой вопрос ДА/НЕТ', () => {
    expect(warPromptText('assault')).toEqual({
      title: 'war.confirm.title',
      body: 'war.confirm.friendly',
      yes: 'war.confirm.yes',
      no: 'war.confirm.no',
    });
  });

  it('ТРАНЗИТ: про маршрут, а кнопка называет ПОСЛЕДСТВИЕ — «объявить войну»', () => {
    expect(warPromptText('transit')).toEqual({
      title: 'war.confirm.title',
      body: 'war.confirm.transit',
      yes: 'war.confirm.go',
      no: 'war.confirm.cancel',
    });
  });

  it('тексты поводов НЕ совпадают — иначе игрок гадал бы, за что подписывается', () => {
    expect(warPromptText('assault').body).not.toBe(warPromptText('transit').body);
    expect(warPromptText('assault').yes).not.toBe(warPromptText('transit').yes);
    expect(warPromptText('assault').no).not.toBe(warPromptText('transit').no);
  });

  it('заголовок ОДИН на оба повода — решение-то одно', () => {
    expect(warPromptText('assault').title).toBe(warPromptText('transit').title);
  });
});
