/**
 * Световые дорожки перевозок под корпусами и мирами: капсулы десанта падают по дуге от борта
 * к поверхности (при погрузке — поднимаются к борту), касание отмечает всплеск. Списка
 * частиц нет: каждая капсула — функция часов голограммы, поэтому после фона и паузы ничего
 * не копится. Ход, след, всплеск и их число — `decisions/troopTransferEffects.ts`; здесь
 * только канва. Отсчёт, полоса и кольцо-часы высадки — плашки `mapTransferTags.ts`.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import type { TroopTransferKind } from '../../decisions/troopTransferTimers';
import {
  activeTroopTransfers,
  podAlpha,
  podCount,
  podCycle,
  podScale,
  podTail,
  podTravel,
  touchdownAge,
  touchdownRing,
  transferArc,
  transferPoint,
  type TransferArc,
} from '../../decisions/troopTransferEffects';
import { fleetAnchor } from './fleetGeometry';
import { motionOn } from './graphicsPrefs';
import { visible, world } from './mapCamera';
import { ASSAULT_TONE, blitGlow, ownerColor, TAU } from './mapPalette';
import { phaseOfId } from './pulseFx';

/** Бюджет на видимые пути, а не на заявки мира; дальние заявки его не занимают. */
const MAX_PATHS = 24;
/** Раскалённое ядро капсулы поверх её цвета. */
const POD_CORE = '#fff6e6';

/** Длина квадратичной дуги, px: среднее хорды и ломаной через вершину — с запасом точно
 *  для выбора числа и размера капсул. */
function arcLength(arc: TransferArc): number {
  const { from: a, control: c, to: b } = arc;
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const hull = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
  return (chord + hull) / 2;
}

function drawStream(
  cx: CanvasRenderingContext2D,
  arc: TransferArc,
  kind: TroopTransferKind,
  color: string,
  now: number,
  phase: number,
  moving: boolean,
): void {
  const length = arcLength(arc);
  const size = podScale(length);
  const pods = podCount(length);
  cx.strokeStyle = color;
  cx.fillStyle = color;
  // Русло: видно и между капсулами, и без движения, но тише следа капсул.
  cx.globalAlpha = 0.22;
  cx.lineWidth = 1;
  cx.beginPath();
  cx.moveTo(arc.from.x, arc.from.y);
  cx.quadraticCurveTo(arc.control.x, arc.control.y, arc.to.x, arc.to.y);
  cx.stroke();
  // Точка касания у конца дуги; без движения на ней стоит неподвижное кольцо.
  cx.globalAlpha = 0.75;
  cx.beginPath();
  cx.arc(arc.to.x, arc.to.y, 1.3 * size, 0, TAU);
  cx.fill();
  if (!moving) {
    cx.globalAlpha = 0.45;
    cx.beginPath();
    cx.arc(arc.to.x, arc.to.y, 4.5 * size, 0, TAU);
    cx.stroke();
  }
  for (let index = 0; index < pods; index++) {
    const u = podCycle(now, phase / TAU, index, pods, moving);
    // Всплеск касания прошлого рейса этой капсулы — под капсулами.
    const age = touchdownAge(u, moving);
    if (age !== null) {
      const ring = touchdownRing(age, size);
      cx.globalAlpha = ring.alpha;
      cx.lineWidth = 1.2;
      cx.beginPath();
      cx.arc(arc.to.x, arc.to.y, ring.r, 0, TAU);
      cx.stroke();
    }
    const alpha = podAlpha(u);
    if (alpha <= 0) continue;
    const k = podTravel(u, kind);
    const tail = podTail(u, kind);
    const head = transferPoint(arc, k);
    // След: три куска, к капсуле толще и ярче — смаз движения, а не пунктир.
    let back = transferPoint(arc, k - tail);
    for (let piece = 1; piece <= 3; piece++) {
      const next = piece === 3 ? head : transferPoint(arc, k - tail * (1 - piece / 3));
      cx.globalAlpha = alpha * (0.1 + 0.25 * piece);
      cx.lineWidth = (0.6 + 0.6 * piece) * size;
      cx.beginPath();
      cx.moveTo(back.x, back.y);
      cx.lineTo(next.x, next.y);
      cx.stroke();
      back = next;
    }
    blitGlow(color, head.x, head.y, 8 * size, alpha * 0.55);
    // Сама капсула вытянута по ходу и несёт раскалённое ядро: это борт, а не искра.
    const dx = Math.cos(head.angle) * 1.8 * size;
    const dy = Math.sin(head.angle) * 1.8 * size;
    cx.globalAlpha = alpha;
    cx.lineWidth = 3.4 * size;
    cx.beginPath();
    cx.moveTo(head.x - dx, head.y - dy);
    cx.lineTo(head.x + dx, head.y + dy);
    cx.stroke();
    cx.strokeStyle = POD_CORE;
    cx.globalAlpha = alpha * 0.95;
    cx.lineWidth = 1.5 * size;
    cx.beginPath();
    cx.moveTo(head.x - dx * 0.5, head.y - dy * 0.5);
    cx.lineTo(head.x + dx * 0.6, head.y + dy * 0.6);
    cx.stroke();
    cx.strokeStyle = color;
  }
  cx.globalAlpha = 1;
}

/** Часы голограммы уже стоят на паузе. Выключенное движение оставляет капсулы на ровных
 *  местах со следом к борту: направление видно и без анимации. */
export function drawTroopTransferEffects(
  s: GameState,
  viewer: string,
  cx: CanvasRenderingContext2D,
  now: number,
): void {
  let painted = 0;
  const moving = motionOn();
  cx.save();
  cx.lineCap = 'round';
  for (const fleet of Object.values(s.fleets)) {
    const links = activeTroopTransfers(fleet, viewer, s.time);
    if (!links.length) continue;
    const planet = s.planets[links[0]!.target];
    if (!planet) continue;
    const center = world(planet.position);
    if (!visible(center, 140)) continue;
    const ship = fleetAnchor(fleet);
    if (!ship || !visible(ship, 40)) continue;
    for (const link of links) {
      const arc = transferArc(center, ship, link.kind);
      if (!arc) continue;
      drawStream(
        cx,
        arc,
        link.kind,
        link.kind === 'assault' ? ASSAULT_TONE : ownerColor(fleet.owner),
        now,
        phaseOfId(fleet.id),
        moving,
      );
      if (++painted >= MAX_PATHS) {
        cx.restore();
        return;
      }
    }
  }
  cx.restore();
}
