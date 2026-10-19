import { describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { pendingHtml } from './pendingPanel';

describe('раздел «Ждёт решения» (UIX-4.2)', () => {
  setLocale('ru');
  const name = (id: string) => `Мир ${id}`;

  it('нет пунктов — нет и раздела с заголовком', () => {
    expect(pendingHtml([], name)).toBe('');
  });

  it('бой — строка с местом и «Показать» с адресом боя', () => {
    const html = pendingHtml([{ kind: 'battle', id: 'b1', location: 'p7', mine: true }], name);
    expect(html).toContain('Ждёт решения');
    expect(html).toContain('Мир p7');
    expect(html).toContain('data-pending="battle" data-id="b1" data-loc="p7"');
    expect(html).toContain('Показать');
  });

  it('свой бой и бой рядом подписаны по-разному', () => {
    const mine = pendingHtml([{ kind: 'battle', id: 'b', location: 'p', mine: true }], name);
    const seen = pendingHtml([{ kind: 'battle', id: 'b', location: 'p', mine: false }], name);
    expect(mine).not.toBe(seen);
  });

  it('письма — счёт со словом по числу и адрес вкладки сообщений', () => {
    const one = pendingHtml([{ kind: 'letters', count: 1 }], name);
    const five = pendingHtml([{ kind: 'letters', count: 5 }], name);
    expect(one).toContain('1 непрочитанное письмо');
    expect(five).toContain('5 непрочитанных писем');
    expect(five).toContain('data-pending="letters"');
  });

  it('имя мира экранируется', () => {
    const html = pendingHtml(
      [{ kind: 'battle', id: 'b', location: 'p', mine: true }],
      () => '<i>x</i>',
    );
    expect(html).not.toContain('<i>x</i>');
  });
});
