import type { GameState } from '@void/shared-core';
import { missilePositionAt } from '@void/shared-core';
import { drawMineShape } from './mineShape';
import { t } from '../../../localization/core';

/** Input MUST be the server projection or visibleOrdnance, never unfiltered state. */
export function drawOrdnance(
  g: CanvasRenderingContext2D,
  ord: GameState['ordnance'],
  viewer: string,
  now: number,
  project: (p: { x: number; y: number }) => { x: number; y: number },
  scale: number,
): void {
  if (!ord) return;
  g.save();
  for (const mine of [...ord.mines, ...ord.installations]) {
    const p = project(mine.position);
    const installing = 'readyAt' in mine;
    const color = mine.owner === viewer ? '#60dbe8' : '#ffac62';
    g.save();
    g.translate(p.x, p.y);
    g.scale(0.8, 0.8);
    g.translate(-12, -12);
    g.strokeStyle = color;
    g.fillStyle = installing ? 'rgba(20,60,70,.12)' : 'rgba(20,60,70,.72)';
    g.lineWidth = 1.2;
    g.setLineDash(installing ? [2, 2] : []);
    g.shadowBlur = 0;
    drawMineShape(g, scale >= 0.9);
    g.restore();
  }
  for (const missile of ord.missiles) {
    const p = project(missilePositionAt(missile, now));
    const target = project(missile.to);
    const own = missile.owner === viewer;
    g.save();
    g.strokeStyle = own ? '#60dbe8' : '#ffac62';
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 1.4;
    g.setLineDash([3, 4]);
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(target.x, target.y);
    g.stroke();
    g.setLineDash([]);
    g.translate(p.x, p.y);
    g.rotate(Math.atan2(target.y - p.y, target.x - p.x));
    g.beginPath();
    g.moveTo(9, 0);
    g.lineTo(-5, -3);
    g.lineTo(-3, 0);
    g.lineTo(-5, 3);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(-6, 0);
    g.lineTo(-13, 0);
    g.stroke();
    g.restore();
    if (!own && scale >= 0.8) {
      g.fillStyle = '#ffac62';
      g.font = '11px sans-serif';
      g.textAlign = 'center';
      g.fillText(t('mine.incoming'), p.x, p.y - 14);
    }
  }
  g.restore();
}
