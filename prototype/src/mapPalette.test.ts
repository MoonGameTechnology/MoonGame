/**
 * Палитра сторон и константы карты (REFM-237) — прямой тест владельца цветов сторон.
 *
 * Цвета сторон меняет только дверь модуля, поэтому здесь проверено то, что текстом не
 * проверить: настройка переживает перезагрузку и не пропускает подмену из хранилища, цвет
 * чужой стороны — твоя стойка к ней (и с того места, за которое ты играешь в сети), места
 * матча покрывают сотню кресел, а свечение слушает тумблер графики. Каждый тест — свежая
 * загрузка модулей над своим хранилищем.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  pairKey,
  type DiplomaticStance,
  type GameState,
} from '../../packages/shared-core/src/index';
import { COLOR, RELATION_SCHEMES } from './sideColors';

let cell: Map<string, string>;

function stubStorage(): void {
  cell = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
}

// Первая загрузка тянет ядро и набор рендера — секунды под нагрузкой полного гейта. Граф
// греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  stubStorage();
  await import('./mapPalette');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(() => {
  stubStorage();
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock('../../packages/client/src/holoDraw');
  vi.unstubAllGlobals();
});

/** Мир, где у пары p1–p2 записана стойка (без записи — война по умолчанию). */
const world = (stance?: DiplomaticStance): GameState =>
  ({ diplomacy: stance ? { [pairKey('p1', 'p2')]: stance } : {} }) as unknown as GameState;

async function boot(me = 'p1', w: GameState = world()) {
  const palette = await import('./mapPalette');
  const ctx = {} as CanvasRenderingContext2D;
  palette.initMapPalette({ world: () => w, me: () => me, ctx: () => ctx, dpr: () => 2 });
  return { palette, ctx };
}

describe('REFM-237 — настройка цветов сторон', () => {
  it('без настройки — свой зелёный, серое ничейное и классическая палитра', async () => {
    const { palette } = await boot();
    expect([palette.youColor, palette.neutralColor, palette.rivalPaletteId]).toEqual([
      COLOR.p1,
      COLOR.null,
      'classic',
    ]);
  });

  it('дверь пишет все три ключа, и выбор переживает перезагрузку', async () => {
    const { palette } = await boot();
    palette.setSideColors('#123456', '#abcdef', 'cvd');
    expect([palette.youColor, palette.neutralColor, palette.rivalPaletteId]).toEqual([
      '#123456',
      '#abcdef',
      'cvd',
    ]);
    expect([...cell]).toEqual([
      ['void.colorYou', '#123456'],
      ['void.colorNeutral', '#abcdef'],
      ['void.rivalPalette', 'cvd'],
    ]);
    vi.resetModules();
    const again = await import('./mapPalette');
    expect([again.youColor, again.neutralColor, again.rivalPaletteId]).toEqual([
      '#123456',
      '#abcdef',
      'cvd',
    ]);
  });

  it('подмена в хранилище и мусор в двери вырождаются в умолчание', async () => {
    cell.set('void.colorYou', '"><img src=x>');
    cell.set('void.colorNeutral', 'red');
    cell.set('void.rivalPalette', 'evil');
    const { palette } = await boot();
    expect([palette.youColor, palette.neutralColor, palette.rivalPaletteId]).toEqual([
      COLOR.p1,
      COLOR.null,
      'classic',
    ]);
    palette.setSideColors('#12345', 'nope', '__proto__');
    expect([palette.youColor, palette.neutralColor, palette.rivalPaletteId]).toEqual([
      COLOR.p1,
      COLOR.null,
      'classic',
    ]);
  });
});

describe('REFM-237 — цвет стороны на карте и в дипломатии', () => {
  it('ничейное — серое, своё — твоим цветом, чужое — по твоей стойке к нему', async () => {
    const classic = RELATION_SCHEMES.classic!;
    expect((await boot('p1', world())).palette.ownerColor('p2')).toBe(classic.war);
    expect((await boot('p1', world('peace'))).palette.ownerColor('p2')).toBe(classic.peace);
    const { palette } = await boot('p1', world('pact'));
    expect(palette.ownerColor('p2')).toBe(classic.bloc);
    expect(palette.ownerColor(null)).toBe(palette.neutralColor);
    expect(palette.ownerColor(undefined)).toBe(palette.neutralColor);
    expect(palette.ownerColor('p1')).toBe(palette.youColor);
  });

  it('в сети ты можешь сидеть на любом месте: своё — то, что назвала игра', async () => {
    const { palette } = await boot('p2', world('peace'));
    expect(palette.ownerColor('p2')).toBe(palette.youColor);
    expect(palette.ownerColor('p1')).toBe(RELATION_SCHEMES.classic!.peace);
  });

  it('смена палитры перекрашивает и карту, и чипы стойки', async () => {
    const { palette } = await boot('p1', world('pact'));
    expect(palette.stanceCol('pact')).toBe(RELATION_SCHEMES.classic!.pact);
    palette.setSideColors(COLOR.p1!, COLOR.null!, 'cvd');
    const cvd = RELATION_SCHEMES.cvd!;
    expect(palette.ownerColor('p2')).toBe(cvd.bloc);
    expect(palette.stanceCol('pact')).toBe(cvd.pact);
    expect(palette.stanceCol('war')).toBe(cvd.war);
  });
});

describe('REFM-237 — места матча', () => {
  it('сто мест: свой цвет у каждого, дома по кругу, и цвет есть в общей таблице', async () => {
    const { palette } = await boot();
    const seats = palette.SEAT_META;
    expect(seats.map((m) => m.id)).toEqual(Array.from({ length: 100 }, (_, i) => `p${i + 1}`));
    expect(new Set(seats.map((m) => m.color)).size).toBe(100);
    const houses = ['azure', 'crimson', 'amber', 'violet'];
    seats.forEach((m, i) => {
      expect(m.faction).toBe(houses[i % 4]);
      expect(COLOR[m.id]).toBe(m.color);
    });
    expect(seats[0]!.color).toBe('#3ad17a');
    expect(seats[10]!.name).toBe('Amber Concord 3'); // одиннадцатое кресло — третий круг Amber
  });
});

describe('REFM-237 — свечение и сферы', () => {
  it('свечение слушает тумблер графики, а оба спрайта берут канвас и плотность хуками', async () => {
    const calls: Array<[string, unknown, unknown]> = [];
    vi.doMock('../../packages/client/src/holoDraw', () => ({
      blitGlow: (cx: unknown, dpr: unknown) => void calls.push(['glow', cx, dpr]),
      blitSphere: (cx: unknown, dpr: unknown) => void calls.push(['sphere', cx, dpr]),
    }));
    const { palette, ctx } = await boot();
    const prefs = await import('./graphicsPrefs');
    prefs.setGlowFx(false);
    palette.blitGlow('#fff', 0, 0, 4, 1);
    palette.blitSphere('#fff', 0, 0, 4);
    expect(calls).toEqual([['sphere', ctx, 2]]);
    prefs.setGlowFx(true);
    palette.blitGlow('#fff', 0, 0, 4, 1);
    expect(calls).toEqual([
      ['sphere', ctx, 2],
      ['glow', ctx, 2],
    ]);
  });
});

describe('REFM-237 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('хуки палитры — мир на экране, своё место, канвас карты и его плотность', () => {
    const init = /initMapPalette\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';
    expect(init).toContain('world: () => s,');
    expect(init).toContain('me: () => ME,');
    expect(init).toContain('ctx: () => cx,');
    expect(init).toContain('dpr: () => DPR,');
  });

  it('настройки меняют цвета только дверью палитры', () => {
    expect(MAIN).toContain(
      'setColors: (you, neutral, palette) => setSideColors(you, neutral, palette),',
    );
    expect(MAIN).toContain("resetColors: () => setSideColors(COLOR.p1!, COLOR.null!, 'classic'),");
  });
});
