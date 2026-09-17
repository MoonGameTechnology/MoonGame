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
const consoleCss = readFileSync(
  fileURLToPath(new URL('../mobile-console.css', import.meta.url)),
  'utf8',
);
const escape = (selector: string) => selector.replace(/[.#*+?^${}()|[\]\\]/g, '\\$&');
const rule = (selector: string) =>
  build.match(new RegExp(`(?:^|\\n)${escape(selector)}\\{[^}]*\\}`))?.[0] ?? '';
// mobile-console.css проходит через prettier: селектор, пробел, скобка, переносы внутри
const mobileRule = (selector: string) =>
  consoleCss.match(new RegExp(`(?:^|\\n)${escape(selector)}\\s*\\{[^}]*\\}`))?.[0] ?? '';

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

describe('узкое правило идёт ПОСЛЕ телефонного блока — иначе он его же и перебьёт', () => {
  // Одинаковая специфичность: решает порядок в файле. Первая версия правки стояла выше
  // блока ≤720px, и тот возвращал прежние отступы — на 320px место снова обрезалось.
  // Ищем само правило, а не строку «@media (max-width:480px)»: она есть и в комментарии.
  const phone = build.indexOf('@media (max-width:720px), ((hover: none) and (pointer: coarse)');

  it('телефонный блок на месте — иначе сканер сторожит пустоту', () => {
    expect(phone).toBeGreaterThan(0);
  });

  it('снятая подпись объявлена ниже него', () => {
    expect(build.indexOf('#tbetacap{display:none;}')).toBeGreaterThan(phone);
  });
});

describe('телефонный бар — плоская полоса, а не карточка с карточками внутри', () => {
  // Отсюда берётся место под ряд 1: бар во всю ширину без скруглений (−8px поля и −1px
  // рамки с каждой стороны) плюс плоские ✦-чип и карточка дня вместо коробок. Вернуть
  // сюда radius и поля можно одной строкой, и ряд снова перестанет помещаться, поэтому
  // правила сторожатся по файлу — раскладку CSS никто, кроме браузера, не считает.
  it('#top: без полей, без рамки по контуру и без скругления', () => {
    const css = mobileRule('body.mobile-ui #top');
    expect(css).toMatch(/margin:\s*0;/);
    expect(css).toMatch(/border:\s*0;/);
    expect(css).toMatch(/border-radius:\s*0;/);
    // нижняя линия остаётся: без неё бар сливается с картой
    expect(css).toMatch(/border-bottom:\s*1px solid/);
  });

  it('✦-чип и карточка дня плоские, разделены волосяной линией', () => {
    const score = mobileRule('body.mobile-ui #tbscore');
    expect(score).toMatch(/border:\s*0;/);
    expect(score).toMatch(/border-radius:\s*0;/);
    expect(score).toMatch(/background:\s*none;/);
    const day = mobileRule('body.mobile-ui #daycard');
    expect(day).toMatch(/border-radius:\s*0;/);
    expect(day).toMatch(/background:\s*none;/);
    expect(day).toMatch(/border-left:\s*1px solid/);
  });
});
