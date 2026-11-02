/** Небольшой транспортный поток под корпусами и мирами, без собственного списка частиц. */
import type { GameState } from '../../packages/shared-core/src/index';
import {
  activeTroopTransfers,
  transferArc,
  transferPoint,
  transferProgress,
  type TransferArc,
} from '../../decisions/troopTransferEffects';
import { fleetAnchor } from './fleetGeometry';
import { fxBreath, motionOn } from './graphicsPrefs';
import { visible, world } from './mapCamera';
import { blitGlow, ownerColor, TAU } from './mapPalette';
import { phaseOfId } from './pulseFx';

/** Бюджет на видимые пути, а не на заявки мира; дальние заявки его не занимают. */
const MAX_PATHS = 24;

function drawStream(
  cx: CanvasRenderingContext2D,
  arc: TransferArc,
  color: string,
  now: number,
  phase: number,
  moving: boolean,
): void {
  cx.strokeStyle = color;
  cx.fillStyle = color;
  cx.lineWidth = 0.7;
  cx.globalAlpha = 0.16;
  cx.beginPath();
  cx.moveTo(arc.from.x, arc.from.y);
  cx.quadraticCurveTo(arc.control.x, arc.control.y, arc.to.x, arc.to.y);
  cx.stroke();
  const capsules = Math.hypot(arc.to.x - arc.from.x, arc.to.y - arc.from.y) < 25 ? 2 : 3;
  for (let index = 0; index < capsules; index++) {
    const k = transferProgress(now, phase / TAU, index, moving, capsules);
    const point = transferPoint(arc, k);
    const tail = transferPoint(arc, k - 0.16);
    const mid = transferPoint(arc, k - 0.08);
    const alpha = Math.min(1, k * 8, (1 - k) * 8);
    cx.globalAlpha = alpha * 0.35;
    cx.lineWidth = 1.1;
    cx.beginPath();
    cx.moveTo(tail.x, tail.y);
    cx.lineTo(mid.x, mid.y);
    cx.lineTo(point.x, point.y);
    cx.stroke();
    // Узкая капсула со светлым ядром; это спокойный трафик, а не трассер оружия.
    cx.globalAlpha = alpha * 0.9;
    cx.lineWidth = 2.4;
    cx.beginPath();
    cx.moveTo(point.x - Math.cos(point.angle) * 1.7, point.y - Math.sin(point.angle) * 1.7);
    cx.lineTo(point.x + Math.cos(point.angle) * 1.7, point.y + Math.sin(point.angle) * 1.7);
    cx.stroke();
    blitGlow(color, point.x, point.y, 7, alpha * 0.22);
  }
  const halo = fxBreath(now, { period: 600, base: 0.12, amp: 0.035, phase });
  cx.globalAlpha = halo;
  cx.lineWidth = 1;
  cx.beginPath();
  cx.arc(arc.to.x, arc.to.y, 5, 0, TAU);
  cx.stroke();
}

/** Часы голограммы уже стоят на паузе. Выкл движения сохраняет статическое направление. */
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
        link.kind === 'assault' ? '#ffb347' : ownerColor(fleet.owner),
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
