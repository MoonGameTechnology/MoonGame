import { describe, it, expect } from 'vitest';
import { t, tData, lookup, hasKey, LOCALE } from './runtime';

// Тест ОБЩЕГО рантайма локализации (LOC-5): раньше он существовал дважды —
// `prototype/src/i18n.ts` и `packages/client/src/i18n.ts`, — и проверялся только со
// стороны клиента. Сами ключи и значения держит гейт `prototype/src/i18n.test.ts`;
// здесь — только поведение поиска и подстановки.

describe('рантайм локализации — t/lookup/tData', () => {
  it('находит заведённый ключ', () => {
    expect(lookup('welcome.title')).toBe('VOID DOMINION');
    expect(t('welcome.title')).toBe('VOID DOMINION');
  });

  it('подставляет {vars}', () => {
    expect(t('client.net.order', { fleet: 'f1', planet: 'A' })).toContain('f1');
    expect(t('client.net.order', { fleet: 'f1', planet: 'A' })).toContain('A');
  });

  it('промах по ключу возвращает сам ключ — это видно, а не пустота', () => {
    expect(t('no.such.key')).toBe('no.such.key');
    expect(lookup('no.such.key')).toBeUndefined();
  });

  it('hasKey отличает заведённый ключ от промаха', () => {
    expect(hasKey('welcome.title')).toBe(true);
    expect(hasKey('no.such.key')).toBe(false);
  });

  it('tData на промахе возвращает исходное имя', () => {
    expect(tData('Some Unknown Unit')).toBe('Some Unknown Unit');
  });

  it('tData переводит имя игровых данных через слаг', () => {
    expect(tData('Spaceport')).toBe(LOCALE === 'ru' ? 'Космопорт' : 'Spaceport');
  });

  it('tData не отдаёт наружу ключ, если в него приехал ключ', () => {
    // Страховка из tData(): слаг `dataKey()` съел бы точки, и игрок увидел бы сам ключ —
    // ровно та ошибка, что светилась на экране совета учёных (`sci.overseer.name`).
    // CONV-12c: тот ключ снят вместе со вторым каталогом (перевод учёного живёт под
    // `data.overseer`), поэтому фикстурой служит живой ключ. Проверяется САМА страховка,
    // а не конкретная запись, так что подходит любой существующий ключ с точками.
    expect(tData('hero.branch.transhuman')).toBe(t('hero.branch.transhuman'));
    expect(tData('hero.branch.transhuman')).not.toBe('hero.branch.transhuman');
  });

  it('LOCALE — известный код языка', () => {
    expect(['ru', 'en']).toContain(LOCALE);
  });
});
