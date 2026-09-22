/** Fleet hold readouts: fixed-width bars replace per-unit map pips. */
import { holdBadgePosition, type FleetHold } from '../../decisions/fleetHolds';
import { t } from '../../localization/runtime';
import { esc } from './format';
import { fleetCountWidth } from '../../packages/client/src/fleetCountBadge';

const number = (n: number): string => String(Math.round(n * 10) / 10);
const color = (m: FleetHold): string => (m.kind === 'hangar' ? '#7bdce8' : '#e6bc7b');
const icon = (m: FleetHold): string => (m.kind === 'hangar' ? '◇' : '▣');
const label = (m: FleetHold): string =>
  m.kind === 'hangar' ? t('cargo.meter.hangar') : t('cargo.meter.troops');

/** Visible figures are actual cargo; the striped segment and its own caption are
 * reservations. A full hold is normal, not a red damage/warning state. */
export function fleetHoldsHtml(meters: readonly FleetHold[]): string {
  if (!meters.length) return '';
  return `<div class="holdmeters">${meters
    .map((m) => {
      const status =
        m.over > 0
          ? t('cargo.meter.over', { n: number(m.over) })
          : t('cargo.meter.free', { n: number(m.free) });
      const loading =
        m.reserved > 0
          ? t('cargo.meter.loading', {
              n: number(m.reserved),
              p: Math.floor(m.loadingProgress * 100),
            })
          : '';
      return `<div class="holdmeter${m.over > 0 ? ' over' : ''}" style="--hold-color:${color(m)}">
      <div class="holdmeter-head"><span>${icon(m)} ${esc(label(m))}</span><b>${number(m.used)} / ${number(m.capacity)}</b></div>
      <div class="holdmeter-track" aria-hidden="true"><i style="width:${m.usedFraction * 100}%"></i><i class="reserved" style="width:${m.reservedFraction * 100}%"></i></div>
      <div class="holdmeter-note"><span>${esc(status)}</span>${loading ? `<span class="holdmeter-loading">${esc(loading)}</span>` : ''}</div>
    </div>`;
    })
    .join('')}</div>`;
}

/** All readings stay upright; their box moves away from the planet, independently
 * of the ship's heading. Unselected fleets use short bars; selection/close zoom adds
 * exact figures. The model is supplied only for the player's own fleets. */
export function drawFleetHoldBadge(
  cx: CanvasRenderingContext2D,
  anchor: { x: number; y: number },
  planet: { x: number; y: number } | null,
  ships: number,
  meters: readonly FleetHold[],
  detailed: boolean,
  ownerColor: string,
): void {
  cx.save();
  cx.font = '700 16px ui-monospace,Menlo,monospace';
  cx.textBaseline = 'middle';
  cx.textAlign = 'left';

  const countWidth = fleetCountWidth(cx, ships);
  const figures = meters.map((m) => `${number(m.used)}/${number(m.capacity)}`);
  const textWidth = detailed ? Math.max(0, ...figures.map((s) => cx.measureText(s).width)) : 0;
  const meterWidth = meters.length ? 44 + (detailed ? textWidth + 5 : 0) : 0;
  const gutter = meters.length ? 7 : 0;
  const width = countWidth + gutter + meterWidth;
  const height = Math.max(26, meters.length * 12 + 4);
  const box = holdBadgePosition(anchor, planet, width, height);

  // One shared frame: fleet tally on the left, hold occupancy on the right.
  // The old nested count badge created two competing borders and made the readout
  // look like two unrelated windows stuck together.
  cx.fillStyle = 'rgba(3,14,22,.88)';
  cx.fillRect(box.x, box.y, width, height);
  cx.strokeStyle = ownerColor;
  cx.lineWidth = 1;
  cx.strokeRect(box.x + 0.5, box.y + 0.5, width - 1, height - 1);
  cx.fillStyle = ownerColor;
  cx.fillRect(box.x, box.y, 3, height);

  const centerY = box.y + height / 2;
  cx.font = '600 10px sans-serif';
  cx.fillText('▱', box.x + 7, centerY);
  cx.font = '700 16px ui-monospace,Menlo,monospace';
  cx.fillStyle = '#f4f8fc';
  cx.fillText(String(ships), box.x + 20, centerY);

  if (meters.length) {
    const dividerX = box.x + countWidth + 0.5;
    cx.strokeStyle = 'rgba(190,219,229,.22)';
    cx.beginPath();
    cx.moveTo(dividerX, box.y + 4);
    cx.lineTo(dividerX, box.y + height - 4);
    cx.stroke();

    const rowStart = box.y + (height - meters.length * 12) / 2;
    cx.font = '600 10px ui-monospace,Menlo,monospace';
    meters.forEach((m, index) => {
      const y = rowStart + index * 12;
      const x = box.x + countWidth + gutter;
      cx.fillStyle = color(m);
      cx.fillText(icon(m), x, y + 6);

      const barX = x + 11;
      const barWidth = 24;
      const barHeight = 5;
      cx.fillStyle = 'rgba(190,219,229,.17)';
      cx.fillRect(barX, y + 3, barWidth, barHeight);
      cx.fillStyle = color(m);
      cx.fillRect(barX, y + 3, barWidth * m.usedFraction, barHeight);
      if (m.reservedFraction > 0) {
        const left = barX + barWidth * m.usedFraction;
        const reservedWidth = barWidth * m.reservedFraction;
        cx.save();
        cx.beginPath();
        cx.rect(left, y + 3, reservedWidth, barHeight);
        cx.clip();
        cx.strokeStyle = color(m);
        cx.lineWidth = 1;
        for (let p = left - barHeight; p < left + reservedWidth; p += 4) {
          cx.beginPath();
          cx.moveTo(p, y + 3 + barHeight);
          cx.lineTo(p + barHeight, y + 3);
          cx.stroke();
        }
        cx.restore();
      }
      if (detailed) {
        cx.fillStyle = m.over > 0 ? '#ff8b7e' : '#e0edf2';
        cx.fillText(figures[index]!, barX + barWidth + 5, y + 6);
      }
    });
  }

  cx.restore();
}
