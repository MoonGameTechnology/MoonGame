/** Fleet hold readouts: fixed-width bars replace per-unit map pips. */
import { holdBadgePosition, type FleetHold } from '../../decisions/fleetHolds';
import { t } from '../../localization/runtime';
import { esc } from './format';

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
  cx.font = '600 10px ui-monospace,Menlo,monospace';
  cx.textBaseline = 'middle';
  cx.textAlign = 'left';
  const figures = meters.map((m) => `${number(m.used)}/${number(m.capacity)}`);
  const textWidth = detailed ? Math.max(0, ...figures.map((s) => cx.measureText(s).width)) : 0;
  const width = Math.max(
    meters.length ? 44 + (detailed ? textWidth + 5 : 0) : 0,
    cx.measureText(`×${ships}`).width + 10,
  );
  const height = 14 + meters.length * 12;
  const box = holdBadgePosition(anchor, planet, width, height);
  if (meters.length) {
    cx.fillStyle = 'rgba(3,14,22,.88)';
    cx.fillRect(box.x, box.y, width, height);
    cx.strokeStyle = 'rgba(153,196,210,.22)';
    cx.lineWidth = 1;
    cx.strokeRect(box.x + 0.5, box.y + 0.5, width - 1, height - 1);
  }
  cx.fillStyle = ownerColor;
  cx.fillText(`×${ships}`, box.x + 5, box.y + 7);
  meters.forEach((m, index) => {
    const y = box.y + 14 + index * 12;
    cx.fillStyle = color(m);
    cx.fillText(icon(m), box.x + 4, y + 4);
    const x = box.x + 15,
      barWidth = 24,
      barHeight = 5;
    cx.fillStyle = 'rgba(190,219,229,.17)';
    cx.fillRect(x, y + 1, barWidth, barHeight);
    cx.fillStyle = color(m);
    cx.fillRect(x, y + 1, barWidth * m.usedFraction, barHeight);
    if (m.reservedFraction > 0) {
      const left = x + barWidth * m.usedFraction;
      const reservedWidth = barWidth * m.reservedFraction;
      cx.save();
      cx.beginPath();
      cx.rect(left, y + 1, reservedWidth, barHeight);
      cx.clip();
      cx.strokeStyle = color(m);
      cx.lineWidth = 1;
      for (let p = left - barHeight; p < left + reservedWidth; p += 4) {
        cx.beginPath();
        cx.moveTo(p, y + 1 + barHeight);
        cx.lineTo(p + barHeight, y + 1);
        cx.stroke();
      }
      cx.restore();
    }
    if (detailed) {
      cx.fillStyle = m.over > 0 ? '#ff8b7e' : '#e0edf2';
      cx.fillText(figures[index]!, x + barWidth + 5, y + 4);
    }
  });
  cx.restore();
}
