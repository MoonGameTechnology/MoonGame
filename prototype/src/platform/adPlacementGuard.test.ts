/**
 * Сторож мест рекламы (`YAG-3.2`) — статический, по той же причине, что соседние сторожа:
 * экран подготовки и `main.ts` живут на DOM, и поднимать их в vitest значило бы проверять
 * мок.
 *
 * Что держит: **ни одно место не показывает ролик без нажатия игрока.** Резолюция
 * владельца (§0.6а роадмапа экономики): реклама только rewarded и только по кнопке, ни
 * одного показа по таймеру, по входу на экран или по событию мира. Способ сломать это
 * один и тихий: позвать ролик из отрисовки, из таймера или из конца забега — игра
 * продолжит работать, а модерация увидит рекламу, которую никто не просил.
 *
 * Поэтому путь к ролику сужен до одной двери и проверяется по ней:
 * `platform.ads.showRewardedAd` зовёт только хост (`watchAd` в `main.ts`), сам хост
 * `watchAd` не зовёт, а отдаёт двум экранам. На экране подготовки её зовёт только помощник
 * `viaAd`, а `viaAd` — только обработчик нажатия. На экране итогов забега — только
 * обработчик нажатия, и только ради удвоения (`run.double`, решение владельца 2026-09-24:
 * ×2 и в конце попытки).
 */
import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AD_PLACEMENTS } from '../../../decisions/adPlacements';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, 'utf8');
/** Игровой код прототипа: без тестов и без самого платформенного слоя. */
const gameFiles = globSync('**/*.ts', { cwd: ROOT }).filter(
  (f) => !f.endsWith('.test.ts') && !f.startsWith('platform/'),
);
const PREP = read('sectorZeroPreparation.ts');
const END = read('endScreen.ts');
const MAIN = read('main.ts');

/** Тело обработчика нажатия на панели подготовки — от подписки до возврата API экрана. */
const clickHandler = (() => {
  const from = PREP.indexOf("panel.addEventListener('click'");
  const to = PREP.indexOf('\n  return {', from);
  return from >= 0 && to > from ? PREP.slice(from, to) : '';
})();

/** Обработчик нажатия на экране итогов — от подписки до возврата API панели. */
const endClickHandler = (() => {
  const from = END.indexOf("host.root().addEventListener('click'");
  const to = END.indexOf('\n  return { render };', from);
  return from >= 0 && to > from ? END.slice(from, to) : '';
})();

/** Вызовы `viaAd(` — без её собственного объявления. */
const viaAdCalls = (src: string): number => (src.match(/(?<!const )\bviaAd\(/g) ?? []).length;

describe('YAG-3.2 — реклама показывается только по нажатию игрока', () => {
  it('обработчик нажатия найден — иначе проверки ниже смотрели бы в пустоту', () => {
    expect(clickHandler.length).toBeGreaterThan(500);
  });

  it('обработчики нажатия найдены — иначе проверки ниже смотрели бы в пустоту', () => {
    expect(endClickHandler.length).toBeGreaterThan(300);
  });

  it('ролик площадки зовёт ровно одно место игры — хост `watchAd`', () => {
    const callers = gameFiles.filter((f) => /\.showRewardedAd\(/.test(read(f)));
    expect(callers).toEqual(['main.ts']);
    expect(MAIN.match(/\.showRewardedAd\(/g)).toHaveLength(1);
    const door = /async function watchAd\([\s\S]*?\n\}/.exec(MAIN)?.[0] ?? '';
    expect(door).toContain('.showRewardedAd(');
  });

  it('хост сам `watchAd` не зовёт — только отдаёт двум экранам', () => {
    expect(MAIN.match(/\bwatchAd\(/g)).toEqual(['watchAd(']); // одно объявление
    expect(MAIN).toContain('async function watchAd(');
    expect(MAIN.match(/^ +watchAd,$/gm)).toHaveLength(2);
  });

  it('`watchAd` зовут два экрана: подготовка — только из помощника `viaAd`', () => {
    const callers = gameFiles.filter((f) => /\.watchAd\(/.test(read(f)));
    expect(callers).toEqual(['endScreen.ts', 'sectorZeroPreparation.ts']);
    expect(PREP.match(/\bh\.watchAd\(/g)).toHaveLength(1);
    const helper = /const viaAd = \([\s\S]*?\n {2}\};/.exec(PREP)?.[0] ?? '';
    expect(helper).toContain('h.watchAd(');
  });

  it('экран итогов зовёт ролик один раз, из обработчика нажатия, и только ради удвоения', () => {
    expect(END.match(/\.watchAd\(/g)).toHaveLength(1);
    expect(endClickHandler).toContain(".watchAd('run.double')");
  });

  it('`viaAd` зовут ТОЛЬКО из обработчика нажатия — ни из отрисовки, ни из таймера', () => {
    expect(viaAdCalls(PREP)).toBeGreaterThan(0);
    expect(viaAdCalls(clickHandler)).toBe(viaAdCalls(PREP));
  });

  it('каждое из четырёх мест подключено к своей кнопке ровно один раз', () => {
    for (const placement of AD_PLACEMENTS) {
      // Перенос строки после скобки — дело форматирования, а не смысла.
      const id = placement.replace('.', '\\.');
      const uses = clickHandler.match(new RegExp(`\\bviaAd\\(\\s*'${id}'`, 'g'))?.length ?? 0;
      expect([placement, uses]).toEqual([placement, 1]);
    }
  });
});
