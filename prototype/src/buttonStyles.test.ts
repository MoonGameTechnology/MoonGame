// Три стиля кнопок (UIX-11.1): главная — действие, ради которого карточка открыта, вторичная —
// остальные действия, тихая — переход и пояснение. Вид кнопка берёт классом `.btn-main`,
// `.btn-second`, `.btn-quiet` (лист `build.mjs`), а правило экрана задаёт ей только размер и
// место. Сторож держит обе половины на переведённых экранах — карточке флота (телефон и ПК),
// производстве и науке (UIX-11.1), карточке мира, разделении флота, окне боя, рынке, штабе
// героев и корпорации (UIX-11.2):
// разметка ставит класс, а лист не красит кнопку поверх него. Правило с id в селекторе
// перебило бы класс, и кнопка тихо вернулась бы к своему цвету.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { cargoSplit, splitSlots } from '../../decisions/splitPlan';
import type { BattleModel } from '../../packages/client/src/matchHud';
import { battleWindowHtml } from './battleScreen';
import { chainStripHtml } from './chainPlanner';
import { commandWindowHtml } from './holographicUi';
import { mobileOrderBar } from './mobileHud';
import { actionButton } from './panelKit';
import { splitDialogHtml, splitRows } from './splitDialog';
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
 *  кнопки науки и производства, кнопки карточки мира, разделения флота и окна боя. Крестик
 *  окна ПК — не приказ и рисуется как крестики окон; раскрывашки окна боя («Состав»,
 *  «Эффекты», «Правила») — строки списка, а не кнопки действия. */
function converted(part: string): boolean {
  const s = subject(part);
  if (s.includes('holo-command-close')) return false;
  if (
    /^\.(tt-take|tt-mbtn|bw-take|cn-build|bw-open|mk-go|mk-btn|hx-btn|hx-dbtn|cbtn2|ctoggle)\b/.test(
      s,
    )
  )
    return true;
  if (/^button\.b(?![-\w])/.test(s)) return true;
  if (part.includes('#splitdlg') && /^(button|\.cbtn)\b/.test(s)) return true;
  if (/#battlewinbody (\.bw-(actions|orders) )?button\b/.test(part) || s.includes('bw-attack'))
    return true;
  if (part.includes('#cmdbar') && /^(button|\[data-cmd|\.holo-command-details)/.test(s))
    return true;
  return part.includes('.mobile-quick') && s.startsWith('button');
}

/** Свойства вида. Подложка (`background-color`) разрешена: липкой кнопке нужна плотная.
 *  Рамка целиком (`border: 1px solid …`) красит её так же, как `border-color`; снять рамку
 *  (`border: 0`) — можно. */
const LOOK =
  /(?<![-\w])(background|background-image|color|border-color|box-shadow|opacity|font|font-weight|font-family|border(?=:\s*(?!0\b|none\b))):/;

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

  it('карточка мира: «Постройки» и «Юниты» — главные, крепость — вторичная, путь в науку — тихий', () => {
    const main = read('./main.ts');
    const tags = [...main.matchAll(/<button class="bw-open[^"]*" data-act="(\w+)"/g)].map(
      (m) => `${m[1]}:${m[0].match(/btn-\w+/)?.[0]}`,
    );
    expect(tags).toEqual([
      'openunits:btn-main',
      'openbuild:btn-main',
      'fortress:btn-second',
      'opentech:btn-quiet',
      'forkfortress:btn-main',
      'opentech:btn-quiet',
    ]);
    expect(actionButton('ping', '', 'Метка', true)).toContain('class="b btn-second"');
  });

  it('разделение флота: шаги — вторичные, «Разделить» — главная, «Отмена» — тихая', () => {
    const units = [{ unit: 'cruiser', count: 3 }];
    const key = splitSlots(units)[0]!.key;
    const html = splitDialogHtml(
      {
        fleetId: 'f1',
        rows: splitRows(splitSlots(units), { [key]: 1 }),
        cargo: cargoSplit(
          [],
          {},
          () => 0,
          () => 1,
        ),
      },
      { icon: () => '', name: (u) => u, moduleName: (m) => m },
    );
    expect(unstyled(html)).toEqual([]);
    expect(html).toMatch(/data-sx="confirm" class="cbtn btn-main"/);
    expect(html).toMatch(/data-sx="cancel" class="cbtn btn-quiet"/);
  });

  it('окно боя: «Атаковать всеми» — главная, отход и атака стороны — вторичные', () => {
    const side = (owner: string, role: 'attacker' | 'defender', mine: boolean) => ({
      owner,
      ownerName: owner,
      ownerFaction: 'x',
      kind: 'fleet' as const,
      units: [{ unit: 'cruiser', count: 3 }],
      mine,
      role,
      ref: { kind: 'fleet' as const, fleetId: `${owner}-1` },
    });
    const sides = [side('p1', 'defender', true), side('p2', 'attacker', false)];
    const m = {
      kind: 'battle',
      id: 'b1',
      location: 'L',
      phase: 'orbital',
      round: 1,
      nextRoundAt: 9000,
      sides,
      attacker: sides[1],
      defender: sides[0],
    } as unknown as BattleModel;
    const html = battleWindowHtml(m, ['p1-1']);
    const toggles = /class="bw-(expand|effect-toggle|more|rules-toggle)\b|class="ptile/;
    expect(unstyled(html).filter((tag) => !toggles.test(tag))).toEqual([]);
    expect(html).toMatch(/class="b bw-attack btn-main" data-battle-attack-all/);
    expect(html).toMatch(/class="b btn-second" data-battle-retreat-all/);
    expect(html).toMatch(/class="b bw-attack btn-second" data-battle-attack=/);
    expect(html).toMatch(/class="b btn-second" data-battle-retreat=/);
  });

  it('рынок, штаб героев, корпорация: у каждой кнопки действия — стиль, главная — одна на форму', () => {
    const src = ['marketScreen.ts', 'heroStaff.ts', 'corpScreen.ts', 'corpBuildingsView.ts']
      .map((f) => read(`./${f}`))
      .join('\n');
    const tags = [
      ...src.matchAll(/<button class="(mk-go|mk-btn|hx-btn|hx-dbtn|cbtn2)[^"]*"[^>]*/g),
    ].map((m) => m[0]);
    expect(tags.length).toBeGreaterThanOrEqual(30);
    expect(tags.filter((tag) => !STYLES.some((c) => tag.includes(c)))).toEqual([]);
    const main = tags
      .filter((tag) => tag.includes('btn-main'))
      .map((tag) => /data-(\w+)/.exec(tag)?.[1]);
    expect(main).toEqual(['mkgo', 'hspawn', 'hskill', 'corpact', 'corpact']);
    expect(src).toContain('class="cbtn2 btn-main" data-corpact="create"');
    expect(src).toContain('class="cbtn2 wide btn-main" data-corpact="build"');
    expect(src).toMatch(/class="hx-btn btn-quiet" data-hunequip=/);
    expect(src).toContain('class="mk-btn btn-second danger" data-mkcancel=');
  });

  it('выбранная вкладка науки и построек — токенами, без мятной заливки', () => {
    for (const sel of ['.tt-tab.on', '.bw-tab.on']) {
      const body = rules(GAME).find((r) => r.sel === sel)?.body ?? '';
      expect(body).toContain('var(--sf-sel)');
      expect(body).not.toMatch(/#4fe0b0|--grn/);
    }
  });
});
