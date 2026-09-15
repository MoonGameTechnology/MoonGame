// TOPBAR: ряд 1 командной панели (‹ · эмблема · ник+место · ✦-чип · карточка дня) не
// помещается в телефон — и до этих правил лишнее не обрезалось, а ВЫЛЕЗАЛО: «1-е из 2»
// уезжало вправо из `.who` и ✦-чип, рисуемый позже, накрывал его собой. Сторожа нет
// нигде, кроме самой CSS: prototype/ вне ESLint и tsc, а jsdom не считает раскладку —
// поэтому правила проверяются сканом файла, как в `hudDock.test.ts`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const build = readFileSync(fileURLToPath(new URL('../build.mjs', import.meta.url)), 'utf8');
const main = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8');
const rule = (selector: string) =>
  build.match(
    new RegExp(`(?:^|\\n)${selector.replace(/[.#*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`),
  )?.[0] ?? '';

describe('обе строки личности обрезаются внутри .who, а не наезжают на ✦-чип', () => {
  it('.who режет содержимое по своей ширине', () => {
    expect(rule('.who')).toMatch(/overflow:hidden/);
  });

  it('и ник, и место — блоки с многоточием (у места его не было — это и был баг)', () => {
    for (const selector of ['.who b', '.who span']) {
      const css = rule(selector);
      expect(css, selector).toMatch(/display:block/);
      expect(css, selector).toMatch(/overflow:hidden/);
      expect(css, selector).toMatch(/text-overflow:ellipsis/);
    }
  });
});

describe('«до след. дня» — отдельный узел, чтобы телефон мог его снять', () => {
  it('в разметке подпись отделена от отсчёта и берёт текст из локали', () => {
    expect(build).toMatch(
      /<span id="tbeta"><\/span><span id="tbetacap" data-i18n="hud\.next-day\.cap"><\/span>/,
    );
  });

  it('в #tbeta уезжают только цифры: собранная строка вернула бы подпись назад', () => {
    expect(main).toMatch(/tbEta\.textContent = eta;/);
    expect(main).not.toMatch(/tbEta\.textContent = t\(/);
  });

  it('узкий телефон подпись прячет', () => {
    expect(build).toMatch(/@media \(max-width:480px\)\{\s*#tbetacap\{display:none;\}/);
  });
});

describe('узкие правила идут ПОСЛЕ телефонного блока — иначе он их же и перебьёт', () => {
  // Одинаковая специфичность: решает порядок в файле. Первая версия правки стояла выше
  // блока ≤720px, и тот возвращал прежние отступы — на 320px место снова обрезалось.
  // Ищем сами правила, а не строку «@media (max-width:480px)»: она есть и в комментарии.
  const phone = build.indexOf('@media (max-width:720px), ((hover: none) and (pointer: coarse)');

  it('телефонный блок на месте — иначе сканер сторожит пустоту', () => {
    expect(phone).toBeGreaterThan(0);
  });

  it('и снятая подпись, и добор отступов объявлены ниже него', () => {
    for (const rule of ['#tbetacap{display:none;}', '.crest{padding:0 4px 0 2px;gap:6px;}'])
      expect(build.indexOf(rule), rule).toBeGreaterThan(phone);
  });
});
