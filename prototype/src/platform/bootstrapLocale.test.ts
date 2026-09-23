/**
 * Сторож языка площадки на старте (`YAG-1.3`) — статический, по той же причине, что
 * `gameplayMarking.test.ts`: `bootstrap.ts` — побочные эффекты на живом DOM и
 * динамический импорт 14 тысяч строк игры, поднимать их в vitest значит проверять мок.
 *
 * Поведение частей покрыто там, где они живут: правило «язык → локаль» —
 * `decisions/platformLocale.test.ts`, «подсказка уступает выбору игрока и не
 * сохраняется» — `localization/core.test.ts`, «адаптер отдаёт язык сырым» —
 * `yandex.test.ts`. Непокрытым остаётся стык, и у него два способа сломаться молча:
 *
 * 1. **Подсказка после импорта игры.** Рендереры игры строятся один раз на том языке,
 *    что стоял в момент импорта, — поздняя подсказка сменит `LOCALE`, но экран останется
 *    на языке браузера. Ни один тест частей этого не видит.
 * 2. **Статика не перерисована.** Кнопки входа уже отрисованы до подъёма площадки; язык
 *    сменился, а они — нет. Игрок видит два языка на одном экране.
 */
import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(new URL('../bootstrap.ts', import.meta.url), 'utf8');

/** Звено цепочки старта, которое импортирует игру: всё про язык обязано стоять выше. */
const CHAIN_MAIN = ".then(() => import('./main'))";

describe('YAG-1.3 — язык площадки применяется на старте, и вовремя', () => {
  it('импорт игры найден — иначе проверки порядка ниже сравнивали бы с -1', () => {
    expect(SRC.indexOf(CHAIN_MAIN)).toBeGreaterThan(-1);
  });

  it('язык площадки идёт через общее правило и подсказывается рантайму', () => {
    expect(SRC).toContain('platformLocale(platform.language)');
    expect(SRC).toMatch(/suggestLocale\(locale\)/);
  });

  it('подсказка стоит ДО импорта игры — иначе её рендереры уже на языке браузера', () => {
    const at = SRC.search(/suggestLocale\(locale\)/);
    expect(at).toBeGreaterThan(SRC.indexOf('setPlatform(platform)'));
    expect(at).toBeLessThan(SRC.indexOf(CHAIN_MAIN));
  });

  it('сменился язык — уже отрисованная статика перерисовывается', () => {
    expect(SRC).toMatch(/if \(locale && suggestLocale\(locale\)\) labelStaticDom\(\);/);
    const body = /function labelStaticDom\(\): void \{([\s\S]*?)\n\}/.exec(SRC)?.[1] ?? '';
    // И текст разметки, и подпись переключателя: подпись вне `data-i18n`, её рисуют руками.
    expect(body).toContain('localizeStaticDom()');
    expect(body).toContain("getElementById('clang')");
  });

  it('язык площадки решается в одной точке — игра не заводит второго правила', () => {
    // Второй вызов где-то в `main.ts` — второе место, где язык выбирается, и первый шаг к
    // тому, чтобы двум правилам разойтись. Точка одна — хост на старте.
    const root = fileURLToPath(new URL('../', import.meta.url));
    const users = globSync('**/*.ts', { cwd: root })
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => readFileSync(`${root}${f}`, 'utf8').includes('platformLocale('));
    expect(users).toEqual(['bootstrap.ts']);
  });
});
