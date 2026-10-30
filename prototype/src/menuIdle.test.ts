/**
 * Сторож меню в покое — статический: `main.ts` и лист стилей живут на DOM. Что хаб, экран
 * входа, меню Sector Zero и настройка партии на телефоне действительно отпускают главный
 * поток, а вход в партию не ждёт, показал замер на эмуляции телефона (2026-10-30). Здесь стыки,
 * и ломаются они молча:
 *
 * 1. **Кадр снова на каждый кадр экрана.** Цикл, который заказывает следующий кадр напрямую,
 *    вернёт меню сборку кадра и пересчёт стилей 60 раз в секунду (правило 9 `simClock.ts`).
 * 2. **Пауза меню без побудки.** Без неё вход в партию ждёт паузы со старой картой на экране, а
 *    Back взводится с опозданием.
 * 3. **Карта под закрытым экраном.** Меню Sector Zero и настройка на телефоне закрывают карту
 *    целиком, а кадр рисовал её под ними: главный поток был занят полностью.
 * 4. **Кадры меню в среднем FPS.** По нему карта отмеряет работу на кадр.
 * 5. **Вечная анимация меню не на композиторе.** Тень, цвет рамки, позиция фона и `left`
 *    перерисовывают кнопку главным потоком каждый кадр: кнопки APK и доната занимали так
 *    больше половины главного потока хаба.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
const body = (name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(MAIN)?.[1] ?? '';

/** Свойства, которые меняет `@keyframes name` (вложенные блоки кадров — по скобкам). */
function keyframeProps(name: string): string[] {
  const at = BUILD.indexOf(`@keyframes ${name}{`);
  if (at < 0) return [];
  let depth = 0;
  let end = at;
  for (let i = BUILD.indexOf('{', at); i < BUILD.length; i++) {
    if (BUILD[i] === '{') depth++;
    else if (BUILD[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const block = BUILD.slice(BUILD.indexOf('{', at) + 1, end);
  return [...new Set([...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!))];
}

describe('меню в покое — кадр (правило 9 `simClock.ts`)', () => {
  it('следующий кадр заказывает одна дверь, и за меню он ждёт паузу', () => {
    expect(MAIN.match(/requestAnimationFrame\(frameLoop\)/g)).toHaveLength(1);
    expect(body('askFrame')).toContain('requestAnimationFrame(frameLoop)');
    const loop = body('frameLoop');
    expect(loop).toMatch(/frame\(nowReal\);\s+covered = mapCovered\(\);/);
    expect(loop).toContain('nextFrameDelay(covered)');
    expect(loop).toContain('setTimeout(askFrame, wait)');
  });

  it('касание, клавиша и смена любого экрана меню будят кадр сразу', () => {
    expect(MAIN).toMatch(
      /for \(const type of \['pointerdown', 'keydown'\] as const\)\s+addEventListener\(type, askFrame, \{ capture: true, passive: true \}\);/,
    );
    expect(MAIN).toContain('new MutationObserver(askFrame)');
    // Те же экраны, что отличают меню от партии в `inMatch`.
    expect(MAIN).toContain("for (const screen of [connectEl, hubEl, setupEl, $('sector-zero')])");
    const inMatch = body('inMatch');
    for (const screen of ['connectEl', 'hubEl', 'sectorZeroMenu', 'setupEl'])
      expect(inMatch, screen).toContain(screen);
  });

  it('карту не рисуют ни под одним полноэкранным экраном', () => {
    const covered = body('mapCovered');
    for (const screen of [
      'connectShown()',
      "hubEl.style.display !== 'none'",
      'sectorZeroMenu.isOpen()',
      'setupCoversMap()',
    ])
      expect(covered, screen).toContain(screen);
    expect(MAIN).toMatch(/!document\.hidden &&\s+!mapCovered\(\) &&\s+!\(NET && !netAdmitted\) &&/);
  });

  it('настройка партии закрывает карту, только когда её окно во весь экран (телефон)', () => {
    const setup = body('setupCoversMap');
    expect(setup).toContain("if (setupEl.style.display === 'none') return false;");
    expect(setup).toContain('box.offsetWidth >= setupEl.offsetWidth');
    expect(setup).toContain('box.offsetHeight >= setupEl.offsetHeight');
  });

  it('кадры меню не идут в средний FPS', () => {
    expect(MAIN).toContain('sinceMenu = mapCovered() ? 0 : sinceMenu + 1;');
    expect(MAIN).toMatch(
      /if \(fpsCounts\(dt, sinceMenu\)\) \{\s+fpsEma = fpsAfter\(fpsEma, dt, sinceMenu\);\s+countNetFrame\(dt\);\s+\}/,
    );
  });
});

describe('меню в покое — вечные анимации кнопок хаба на композиторе', () => {
  const COMPOSITOR = new Set(['opacity', 'transform']);
  for (const name of [
    'donateBreath',
    'donateShine',
    'hub-apk-glow',
    'hub-apk-shine',
    'hub-apk-nod',
  ]) {
    it(`@keyframes ${name}: только прозрачность и сдвиг`, () => {
      const props = keyframeProps(name);
      expect(props.length, name).toBeGreaterThan(0);
      expect(
        props.filter((p) => !COMPOSITOR.has(p)),
        name,
      ).toEqual([]);
    });
  }
});
