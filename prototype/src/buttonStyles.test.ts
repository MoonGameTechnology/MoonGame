// Три стиля кнопок (UIX-11.1): главная — действие, ради которого карточка открыта, вторичная —
// остальные действия, тихая — переход и пояснение. Вид кнопка берёт классом `.btn-main`,
// `.btn-second`, `.btn-quiet` (лист `build.mjs`), а правило экрана задаёт ей только размер и
// место. Сторож держит обе половины на переведённых экранах — карточке флота (телефон и ПК),
// производстве и науке: разметка ставит класс, а лист не красит кнопку поверх него. Правило с
// id в селекторе перебило бы класс, и кнопка тихо вернулась бы к своему цвету.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { chainStripHtml } from './chainPlanner';
import { commandWindowHtml } from './holographicUi';
import { mobileOrderBar } from './mobileHud';
import { troopsMenuHtml, troopsModel } from './troopsMenu';

beforeAll(() => setLocale('ru'));

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const BUILD = read('../build.mjs');
const GAME = BUILD.slice(BUILD.indexOf('const css = `'), BUILD.indexOf('const adminCss = `'));
const SHEETS: Record<string, string> = {
  'build.mjs': GAME,
  'holographic.css': read('../holographic.css'),
  'mobile-console.css': read('../mobile-console.css'),
  'mobile-strategy.css': read('../mobile-strategy.css'),
};
const STYLES = ['btn-main', 'btn-second', 'btn-quiet'];

/** Правила листа целиком: селектор (все строки) и тело. Комментарии вырезаны. */
function rules(sheet: string): { sel: string; body: string }[] {
  const text = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1]!.replace(/\s+/g, ' ').trim(),
    body: m[2]!,
  }));
}

/** Запятые верхнего уровня: `:is(a,b)` — одна часть, а не две. */
function parts(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Последнее звено селектора — то, что правило красит. */
function subject(part: string): string {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < part.length; i++) {
    const ch = part[i]!;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) cut = i + 1;
  }
  return part.slice(cut).trim();
}

/** Кнопка переведённого экрана: ряд приказов флота, «Сведения» листа телефона, главные
 *  кнопки науки и производства. Крестик окна ПК — не приказ и рисуется как крестики окон. */
function converted(part: string): boolean {
  const s = subject(part);
  if (s.includes('holo-command-close')) return false;
  if (/^\.(tt-take|tt-mbtn|bw-take|cn-build)\b/.test(s)) return true;
  if (part.includes('#cmdbar') && /^(button|\[data-cmd|\.holo-command-details)/.test(s))
    return true;
  return part.includes('.mobile-quick') && s.startsWith('button');
}

/** Свойства вида. Подложка (`background-color`) разрешена: липкой кнопке нужна плотная. */
const LOOK =
  /(?<![-\w])(background|background-image|color|border-color|box-shadow|opacity|font|font-weight|font-family):/;

describe('три стиля кнопок (UIX-11.1)', () => {
  it('классы стилей заданы токенами, без своих цветов', () => {
    const own = rules(GAME).filter((r) => STYLES.some((c) => r.sel.includes(`.${c}`)));
    expect(own.length).toBeGreaterThan(5);
    for (const c of STYLES) expect(own.some((r) => r.sel === `.${c}`)).toBe(true);
    const raw = own.filter((r) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(r.body)).map((r) => r.sel);
    expect(raw).toEqual([]);
  });

  it.each(Object.keys(SHEETS))('%s: правило экрана не красит переведённую кнопку', (name) => {
    const painted = rules(SHEETS[name]!)
      .filter((r) => parts(r.sel).some(converted) && LOOK.test(r.body))
      .map((r) => `${r.sel} { ${LOOK.exec(r.body)![1]} }`);
    expect(painted).toEqual([]);
  });

  it('главные кнопки науки и производства — .btn-main', () => {
    const src = ['techTree.ts', 'buildScreen.ts', 'shipyard.ts']
      .map((f) => read(`./${f}`))
      .join('\n');
    const tags = [...src.matchAll(/<button class="(tt-take|tt-mbtn|bw-take|cn-build)[^"]*"/g)].map(
      (m) => m[0],
    );
    expect(tags.length).toBeGreaterThanOrEqual(10);
    expect(tags.filter((tag) => !tag.includes('btn-main'))).toEqual([]);
  });

  it('ряд приказов: «Курс» — главная, остальные — вторичные, состояние добавляется к стилю', () => {
    const main = read('./main.ts');
    const fn = main.slice(
      main.indexOf('function cmdBtn('),
      main.indexOf('function mobileOrderKind('),
    );
    expect(fn).toContain("cmd === 'move' ? 'btn-main' : 'btn-second'");
    expect(
      [...fn.matchAll(/<button data-cmd="\$\{cmd\}" class="([^"]*)"/g)].map((m) => m[1]),
    ).toEqual(['${look}', '${look}']);
    expect(main).toMatch(/data-cmd="castdo" class="btn-second"/);
    expect(main).toMatch(
      /data-cmd="retrset" data-at="\$\{at\}" class="btn-second\$\{on \? ' on' : ''\}"/,
    );
  });

  const unstyled = (html: string): string[] =>
    [...html.matchAll(/<button\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => !STYLES.some((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(tag)));

  it('полоска «Приказ»: «Отправить» — главная, «Отмена» — вторичная красная', () => {
    const html = chainStripHtml({
      fleets: 1,
      count: 2,
      cap: 8,
      canUndo: true,
      canHome: true,
      clearMode: false,
      canSend: true,
      overwrite: false,
    });
    expect(unstyled(html)).toEqual([]);
    expect(html).toMatch(/data-cmd="chsend" class="btn-main"/);
    expect(html).toMatch(/data-cmd="chexit" class="btn-second danger"/);
  });

  it('приказ на телефоне: «Отправить» — главная, «Отмена» — вторичная', () => {
    for (const html of [mobileOrderBar('Курс', 'LETHE-5'), mobileOrderBar('Курс', null, true)]) {
      expect(unstyled(html)).toEqual([]);
      expect(html).toMatch(/data-cmd="(mobile-send|pick)" class="btn-main"/);
    }
  });

  it('десант: шаг — вторичная, «до упора» — тихая, «Подтвердить» — главная', () => {
    const html = troopsMenuHtml(
      troopsModel({
        units: [
          {
            unit: 'militia',
            garrison: 5,
            garrisonAll: 5,
            hold: 0,
            holdAll: 0,
            queued: 0,
            reserved: 0,
            cargoSize: 1,
          },
        ],
        capacity: 8,
        used: 0,
        reservedCargo: 0,
        plan: { militia: 1 },
      }),
      { icon: () => '', name: (u) => u },
    );
    expect(unstyled(html)).toEqual([]);
    expect(html).toContain('data-cmd="tok" class="cbtn btn-main"');
    expect(html).toContain('data-cmd="tcancel" class="cbtn btn-quiet"');
  });

  it('окно флота на ПК: «Подробнее о флоте» — тихая, крестик — свой', () => {
    const html = commandWindowHtml('', 'PALADIN 2', 'LETHE-5');
    expect(unstyled(html).map((tag) => /class="([^"]*)"/.exec(tag)?.[1])).toEqual([
      'holo-command-close',
    ]);
    expect(html).toContain('class="holo-command-details btn-quiet"');
  });

  it('выбранная вкладка науки и построек — токенами, без мятной заливки', () => {
    for (const sel of ['.tt-tab.on', '.bw-tab.on']) {
      const body = rules(GAME).find((r) => r.sel === sel)?.body ?? '';
      expect(body).toContain('var(--sf-sel)');
      expect(body).not.toMatch(/#4fe0b0|--grn/);
    }
  });
});
