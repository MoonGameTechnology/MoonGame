/**
 * Палитра сторон и константы карты — у одного владельца (REFM-237).
 *
 * Цвет стороны читают карта, карточки и окна (дипломатия, верфь, досье), а меняет его одна
 * дверь — {@link setSideColors}, её зовут настройки. `main.ts` читает выбранные цвета живыми
 * привязками (`export let`): присвоить мимо владельца не даст компилятор. Сама палитра и
 * правило «цвет = отношение» живут в `sideColors.ts`; здесь — клиентская настройка поверх
 * них, цвета мест матча и константы рисования карты.
 *
 * Мир, своё место, контекст канваса и его плотность пикселей живут в `main.ts`; модуль
 * получает их хуками {@link initMapPalette} — импорт оттуда был бы циклом.
 */
import {
  getStance,
  type DiplomaticStance,
  type GameState,
} from '../../packages/shared-core/src/index';
import {
  blitGlow as hdBlitGlow,
  blitSphere as hdBlitSphere,
} from '../../packages/client/src/holoDraw';
import { glowOn } from './graphicsPrefs';
import { readRaw, writeRaw } from './prefs';
import {
  COLOR,
  isPaletteId,
  paletteOf,
  relationColor,
  safeHexColor,
  stanceColor,
} from './sideColors';

/** Что палитре нужно от игры. Мир, своё место и канвас живут в `main.ts`. */
export interface MapPaletteHost {
  /** Мир на экране: цвет чужой стороны — твоя стойка к ней. */
  world(): GameState;
  /** Твоё место. */
  me(): string;
  /** Контекст канваса карты. */
  ctx(): CanvasRenderingContext2D;
  /** Плотность пикселей канваса: от неё зависят спрайты свечения. */
  dpr(): number;
}

let game: MapPaletteHost;

/** Поднять палитру: хуки игры. Зовётся из `main.ts` один раз, до первого кадра. */
export function initMapPalette(host: MapPaletteHost): void {
  game = host;
}

// --- side-colour SCHEMES (client-only, localStorage) --------------------------
// Палитра и само правило «цвет = отношение» живут в `sideColors.ts` — одной таблицей на
// оба представления (карта и экран дипломатии). Здесь остаётся только клиентская
// НАСТРОЙКА: свой цвет, ничейное пространство и выбранная палитра.
export let youColor = safeHexColor(readRaw('void.colorYou'), COLOR.p1!);
export let neutralColor = safeHexColor(readRaw('void.colorNeutral'), COLOR.null!);
export let rivalPaletteId = readRaw('void.rivalPalette') ?? 'classic';
if (!isPaletteId(rivalPaletteId)) rivalPaletteId = 'classic';
export function setSideColors(you: string, neutral: string, palette: string): void {
  youColor = safeHexColor(you, COLOR.p1!);
  neutralColor = safeHexColor(neutral, COLOR.null!);
  rivalPaletteId = isPaletteId(palette) ? palette : 'classic';
  writeRaw('void.colorYou', youColor);
  writeRaw('void.colorNeutral', neutralColor);
  writeRaw('void.rivalPalette', rivalPaletteId);
}
// Political colour is relative to the local commander: YOU are your configured hue,
// unowned space grey, and every other commander is coloured by your STANCE toward them
// (enemy red / friendly blue / neutral grey — see relationColor). Works for solo
// (you = p1) and net (you may be any seat). Stance is public (never fogged), so the
// client always has the true value.
export function ownerColor(owner: string | null | undefined): string {
  if (!owner) return neutralColor; // unowned territory (void / no-man's land)
  const me = game.me();
  if (owner === me) return youColor; // you
  return relationColor(getStance(game.world(), me, owner), paletteOf(rivalPaletteId));
}
/** Цвет чипа стойки на экране дипломатии — из той же палитры, что и карта. */
export function stanceCol(st: DiplomaticStance): string {
  return stanceColor(st, paletteOf(rivalPaletteId));
}

// The ten possible commanders, in stable seat order. Seat 1 is always you (human);
// seats 2-10 are AI or off in the setup screen. Four faction passives cycle across seats.
export const SEAT_META: Array<{ id: string; name: string; faction: string; color: string }> = [
  { id: 'p1', name: 'Azure Compact', faction: 'azure', color: COLOR.p1! },
  { id: 'p2', name: 'Crimson Hegemony', faction: 'crimson', color: COLOR.p2! },
  { id: 'p3', name: 'Amber Concord', faction: 'amber', color: COLOR.p3! },
  { id: 'p4', name: 'Violet Ascendancy', faction: 'violet', color: COLOR.p4! },
  { id: 'p5', name: 'Azure Compact II', faction: 'azure', color: COLOR.p5! },
  { id: 'p6', name: 'Crimson Hegemony II', faction: 'crimson', color: COLOR.p6! },
  { id: 'p7', name: 'Amber Concord II', faction: 'amber', color: COLOR.p7! },
  { id: 'p8', name: 'Violet Ascendancy II', faction: 'violet', color: COLOR.p8! },
  { id: 'p9', name: 'Azure Compact III', faction: 'azure', color: COLOR.p9! },
  { id: 'p10', name: 'Crimson Hegemony III', faction: 'crimson', color: COLOR.p10! },
];
// Extra seats use the same faction cycle, with stable distinct map colors.
for (let i = 10; i < 100; i++) {
  const house = SEAT_META[i % 4]!;
  const color =
    '#' + [73, 107, 131].map((k) => (80 + ((i * k) % 156)).toString(16).padStart(2, '0')).join('');
  COLOR[`p${i + 1}`] = color;
  SEAT_META.push({
    id: `p${i + 1}`,
    name: `${house.name} ${Math.floor(i / 4) + 1}`,
    faction: house.faction,
    color,
  });
}

export const GRID = 'rgba(46,150,160,0.07)';
export const LOCK = '#7df0d0'; // selection / targeting reticle accent
export const HOSTILE = '#ff5a4d'; // «Атака»: цели и путь к ним — красным (заказ владельца 2026-09-24)
// RANGE-UX: три вида оружия — три РАЗНЫХ цвета, чтобы круги не сливались в кашу, когда
// в выделении и артиллерия, и носитель. Линия огня — того же цвета, что круг стрелка.
export const R_ARTY = '#ffb43a'; // артиллерия: янтарный (как и весь огневой контур в HUD)
export const R_WING = '#9ad7ff'; // эскадрилья: холодный голубой
export const R_AA = '#c07dff'; // ПКО: сиреневый — это ОТМЕТКА на мире, а не область
// HERO-CORRIDOR: одноразовый коридор — КРАСНЫЙ мигающий пунктир (он исчезнет с первым
// же проходом, это не дорога); временный и общий — спокойная бирюза с таймером.
export const CORR_ONCE = '#ff5c5c';
export const CORR_LIVE = '#5ce1d6';
// CAST-UX: круги прицела каста. Отдельные имена, а не переиспользование LOCK, потому
// что дальность и область — РАЗНЫЕ сущности, и игрок должен различать их с одного
// взгляда: тонкий пунктир «докуда достану» против залитого пятна «что накроет».
export const CAST_REACH = '#7df0d0'; // круг дальности способности
export const CAST_FAR = '#ff6b6b'; // цель вне дальности — подсказка, вердикт всё равно за ядром
// Радиус способности — всегда этот фиолетовый, и всегда пунктиром: на карте уже есть
// кольца дальности огня и радара, и способность обязана читаться как ДРУГАЯ сущность.
export const ABILITY_RING = '#b78cff';
export const TAU = Math.PI * 2;

// Holographic draw primitives (rgba tint, cached glow/sphere sprites) now live in the
// shared render kit (@void/client · holoDraw.ts, CP0.2 — one render implementation). The
// prototype keeps thin same-named delegators so every call site is unchanged; they pass the
// map canvas ctx + current DPR (hooks of `initMapPalette`), and the kit owns the dpr-keyed
// sprite caches.
export function blitGlow(color: string, x: number, y: number, r: number, a: number): void {
  if (!glowOn()) return; // graphics pref: glow & haloes off → skip the bloom discs entirely
  hdBlitGlow(game.ctx(), game.dpr(), color, x, y, r, a);
}
export function blitSphere(
  color: string,
  x: number,
  y: number,
  r: number,
  a = 1,
  clockMs = 0,
): void {
  hdBlitSphere(game.ctx(), game.dpr(), color, x, y, r, a, clockMs);
}

// Map-marker geometry / palette, shared so every blip reads the same way.
export const CARDINAL: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
export const ORBIT_COLOR = '#7df0d0'; // the single orbit ring (GDD §7.4 — no near/far split)
