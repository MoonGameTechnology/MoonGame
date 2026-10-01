import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { setupRivalsHtml } from './setupRivals';

beforeAll(() => setLocale('ru'));

describe('шапка мест на экране настройки (UIX-15.1, UIX-8.2)', () => {
  it('число соперников и одна строка правила кнопки', () => {
    const html = setupRivalsHtml(3, false);
    expect(html).toContain('<b>Соперники: 3</b>');
    expect(html).toContain(
      '<span>Кнопка в строке: выкл → слабый → сильный. Кружок — цвет игрока на карте.</span>',
    );
  });

  it('подробности спрятаны под «?», и кнопка говорит скринридеру, что она раскрывает', () => {
    const html = setupRivalsHtml(1, false);
    expect(html).toContain(
      'data-setuphelp="1" aria-expanded="false" aria-label="Подробнее о соперниках">?</button>',
    );
    expect(html).not.toContain('class="shelp"');
  });

  it('раскрытое «?» показывает разницу слабого и сильного бота и песочницу', () => {
    const html = setupRivalsHtml(0, true);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(
      /<p class="shelp">Слабый бот умеет то же, что сильный, .*мирная песочница\.<\/p>$/,
    );
  });
});
