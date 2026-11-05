/**
 * Свои активные перевозки и их световые дорожки на карте. Только картинка.
 *
 * Дорожка — дуга от борта к поверхности (у погрузки — от поверхности к борту), по ней
 * идут капсулы десанта. Заказ владельца 2026-11-05: прежний поток читался неподвижным
 * пунктиром, его нужно было оживить.
 *
 * 1. **Капсула падает с разгоном.** К миру она ускоряется, как в колодце притяжения, у
 *    борта при погрузке тормозит, как при стыковке: равномерный ход по короткой дуге
 *    читался ползущим пунктиром, а не движением.
 * 2. **Хвост длиннее там, где капсула быстрее.** След — это смаз движения, поэтому его
 *    длина идёт от скорости, а не постоянна: у борта капсула едва отделилась, у поверхности
 *    летит со следом.
 * 3. **Касание — всплеск у цели.** Капсула не тает перед поверхностью, а бьётся в неё:
 *    в миг касания у конца дуги расходится кольцо {@link TOUCHDOWN_MS}.
 * 4. **Выключенное движение оставляет направление.** Капсулы стоят на ровных местах дуги
 *    со следом, обращённым к началу: и неподвижный рисунок говорит, куда идут войска.
 *    Всплесков без движения нет — им нечего отмечать.
 * 5. **Число капсул — от длины дуги.** На телефоне вдали дуга короче двадцати точек, и
 *    три капсулы слиплись бы в одну черту.
 * 6. **Высадка кончается касанием.** Когда десант ступил на мир (`assault.ashore`), дуга
 *    штурма не гаснет молча: по миру расходится кольцо {@link LANDING_FLASH_MS} и вспыхивает
 *    его поверхность (средний тир отклика, скилл `mobile-game-feel`). Без движения кольцо
 *    не расходится, а стоит на середине разлёта и гаснет.
 */
import type { Fleet } from '../packages/shared-core/src/index';
import type { TroopTransferKind as TransferKind } from './troopTransferTimers';

export interface TransferLink {
  target: string;
  kind: TransferKind;
}
type TransferFleet = Pick<
  Fleet,
  'owner' | 'location' | 'movement' | 'loading' | 'unloading' | 'assaultLanding'
>;

/** Один путь на флот и вид операции, независимо от числа типов перевозимых войск. */
export function activeTroopTransfers(
  f: TransferFleet,
  viewer: string,
  now: number,
): TransferLink[] {
  if (f.owner !== viewer || !f.location || f.movement) return [];
  const active = (claim: { startAt: number; doneAt: number }): boolean =>
    claim.startAt <= now && now < claim.doneAt;
  const links: TransferLink[] = [];
  if (f.loading?.some((c) => c.from === f.location && c.count > 0 && active(c))) {
    links.push({ target: f.location, kind: 'load' });
  }
  if (f.unloading?.some((c) => c.to === f.location && c.count > 0 && active(c))) {
    links.push({ target: f.location, kind: 'unload' });
  }
  if (f.assaultLanding?.planetId === f.location && active(f.assaultLanding)) {
    links.push({ target: f.location, kind: 'assault' });
  }
  return links;
}

interface Point {
  x: number;
  y: number;
}
export interface TransferArc {
  from: Point;
  control: Point;
  to: Point;
}

/** Экранные концы обрезаны до края объекта и корпуса; встречные операции — разными дугами. */
export function transferArc(planet: Point, fleet: Point, kind: TransferKind): TransferArc | null {
  const dx = fleet.x - planet.x,
    dy = fleet.y - planet.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 12) return null;
  const ux = dx / distance,
    uy = dy / distance;
  const inset = Math.min(12, distance * 0.22);
  const hold = Math.min(5, distance * 0.12);
  const surface = { x: planet.x + ux * inset, y: planet.y + uy * inset };
  const ship = { x: fleet.x - ux * hold, y: fleet.y - uy * hold };
  const bend = Math.min(18, Math.max(8, distance * 0.25)) * (kind === 'load' ? -1 : 1);
  const control = {
    x: (surface.x + ship.x) / 2 - uy * bend,
    y: (surface.y + ship.y) / 2 + ux * bend,
  };
  return kind === 'load'
    ? { from: surface, control, to: ship }
    : { from: ship, control, to: surface };
}

/** Квадратичная дуга и её касательная: капсула и её след смотрят по движению. */
export function transferPoint(arc: TransferArc, progress: number): Point & { angle: number } {
  const k = Math.max(0, Math.min(1, progress)),
    v = 1 - k;
  const { from: a, control: c, to: b } = arc;
  return {
    x: v * v * a.x + 2 * v * k * c.x + k * k * b.x,
    y: v * v * a.y + 2 * v * k * c.y + k * k * b.y,
    angle: Math.atan2(v * (c.y - a.y) + k * (b.y - c.y), v * (c.x - a.x) + k * (b.x - c.x)),
  };
}

/** Один рейс капсулы от начала дуги до касания, мс (часы голограммы). */
export const POD_TRIP_MS = 2400;
/** Сколько живёт всплеск касания, мс (правило 3). */
export const TOUCHDOWN_MS = 560;
/** Крутизна разгона капсулы (правило 1): 1 — равномерно, больше — резче к концу. */
const POD_EASE = 1.8;
/** Доля рейса, за которую капсула проявляется у начала дуги. */
const POD_FADE_IN = 0.14;

/** Сколько капсул на дуге такой длины, px (правило 5). */
export function podCount(arcLength: number): number {
  if (arcLength < 30) return 2;
  return arcLength < 84 ? 3 : 4;
}

/** Масштаб капсулы и всплеска для дуги такой длины, px: короткая дуга — мельче рисунок. */
export function podScale(arcLength: number): number {
  return Math.max(0.7, Math.min(1.25, arcLength / 64));
}

/**
 * Доля рейса капсулы `index` из `count`: 0 — у начала дуги, 1 — касание. `phase` (0…1) —
 * от флота, чтобы соседние потоки не шли в ногу. Без движения — ровные неподвижные места
 * `(i+1)/(n+1)` (правило 4).
 */
export function podCycle(
  now: number,
  phase: number,
  index: number,
  count: number,
  moving: boolean,
): number {
  if (!moving) return (index + 1) / (count + 1);
  const cycle = now / POD_TRIP_MS + phase + index / count;
  return cycle - Math.floor(cycle);
}

/** Где на дуге капсула при доле рейса `u` (правило 1): к миру — с разгоном, к борту — с
 *  торможением. Концы неподвижны: 0 → 0, 1 → 1. */
export function podTravel(u: number, kind: TransferKind): number {
  const k = Math.max(0, Math.min(1, u));
  return kind === 'load' ? 1 - (1 - k) ** POD_EASE : k ** POD_EASE;
}

/** Длина следа капсулы в долях дуги (правило 2): от скорости в этой точке рейса. */
export function podTail(u: number, kind: TransferKind): number {
  const k = Math.max(0, Math.min(1, u));
  const speed = POD_EASE * (kind === 'load' ? 1 - k : k) ** (POD_EASE - 1); // 0…POD_EASE
  return 0.07 + 0.13 * speed;
}

/** Яркость капсулы: проявляется у начала дуги и яркая до самого касания (правило 3). */
export function podAlpha(u: number): number {
  return Math.max(0, Math.min(1, u / POD_FADE_IN));
}

/** Всплеск касания капсулы: возраст 0…1 или `null`, если всплеска сейчас нет. Касание
 *  было в начале её нового рейса, поэтому возраст — время от начала рейса (правило 3). */
export function touchdownAge(u: number, moving: boolean): number | null {
  if (!moving) return null;
  const age = (u * POD_TRIP_MS) / TOUCHDOWN_MS;
  return age >= 0 && age < 1 ? age : null;
}

/** Кольцо всплеска: растёт быстро и тормозит, гаснет к концу жизни. `scale` — {@link podScale}. */
export function touchdownRing(age: number, scale: number): { r: number; alpha: number } {
  const k = Math.max(0, Math.min(1, age));
  const grow = 1 - (1 - k) ** 3;
  return { r: (1.5 + 8.5 * grow) * scale, alpha: 0.85 * (1 - k) ** 1.6 };
}

/** Сколько живёт вспышка высадки у мира, мс (правило 6). */
export const LANDING_FLASH_MS = 600;

/** Вспышка высадки (правило 6): `ring` — радиус кольца от края мира наружу, `glow` — пятна
 *  на поверхности, px; `alpha` гаснет к концу жизни. */
export function landingBurst(
  progress: number,
  motion: boolean,
): { ring: number; glow: number; alpha: number } {
  const k = Math.max(0, Math.min(1, progress));
  const grow = motion ? 1 - (1 - k) ** 3 : 0.5;
  return { ring: 15 + 25 * grow, glow: 9 + 9 * grow, alpha: (1 - k) ** 1.4 };
}
