/** Presentation-only signals. Callers keep visibility, ownership and hit testing. */
import { rgba } from '../../packages/client/src/holoDraw';

const TAU = Math.PI * 2;

/** Orbital contact = rotating arcs; ground combat = a fixed, advancing front. */
export function drawHolographicBattle(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  clock: number,
  phase: 'orbital' | 'ground',
  glow: boolean,
): void {
  const ground = phase === 'ground';
  const color = ground ? '#f5bd68' : '#ff827c';
  const turn = clock / 6200;
  const beat = (clock % 2600) / 2600;
  g.save();
  g.translate(x, y);
  g.shadowColor = color;
  g.shadowBlur = glow ? 7 : 0;
  // A low-luminance contact wash, never a full-screen flash or a damage claim.
  const wash = g.createRadialGradient(0, 0, 5, 0, 0, 46);
  wash.addColorStop(0, rgba(color, 0.055));
  wash.addColorStop(1, rgba(color, 0));
  g.fillStyle = wash;
  g.fillRect(-46, -46, 92, 92);
  if (ground) {
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const k = (beat + i / 3) % 1;
      const r = 15 + k * 22;
      g.strokeStyle = rgba(color, (1 - k) * 0.48);
      g.setLineDash([6, 4]);
      g.strokeRect(-r, -r * 0.6, r * 2, r * 1.2);
    }
    g.setLineDash([]);
    g.strokeStyle = rgba(color, 0.9);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-17, 18);
    g.lineTo(17, 18);
    g.stroke();
    // Three steady teeth identify a surface front even with animation disabled.
    for (const at of [-12, 0, 12]) {
      g.beginPath();
      g.moveTo(at - 3, 22);
      g.lineTo(at, 18);
      g.lineTo(at + 3, 22);
      g.stroke();
    }
  } else {
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const angle = turn + (i * TAU) / 3;
      g.strokeStyle = rgba(color, 0.65);
      g.beginPath();
      g.arc(0, 0, 27, angle, angle + 0.9);
      g.stroke();
      g.strokeStyle = rgba(color, 0.24);
      g.beginPath();
      g.arc(0, 0, 36, -angle, -angle + 0.55);
      g.stroke();
    }
    g.strokeStyle = rgba(color, (1 - beat) * 0.4);
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(0, 0, 18 + beat * 28, 0, TAU);
    g.stroke();
    // Short opposed activity traces are contained inside the contact reticle.
    // They do not connect hidden units or imply simulated hits/projectile paths.
    for (let i = 0; i < 2; i++) {
      const a = turn * 0.7 + i * Math.PI;
      const r = 12 + Math.sin(clock / 1700 + i * 2) * 3;
      g.strokeStyle = rgba(color, 0.7);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      g.lineTo(Math.cos(a + 0.22) * (r + 5), Math.sin(a + 0.22) * (r + 5));
      g.stroke();
    }
  }
  g.shadowBlur = 0;
  g.restore();
}

/** Owner-coloured beacon. Its head stays at the original pin's hit target. */
export function drawHolographicPing(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  clock: number,
  phase: number,
  glow: boolean,
): void {
  g.save();
  g.translate(x, y);
  g.shadowColor = color;
  g.shadowBlur = glow ? 6 : 0;
  for (let i = 0; i < 2; i++) {
    const k = ((clock / 3000 + phase / TAU + i / 2) % 1 + 1) % 1;
    g.strokeStyle = rgba(color, (1 - k) * 0.62);
    g.lineWidth = 1.4 - k * 0.7;
    g.beginPath();
    g.arc(0, 0, 10 + k * 44, 0, TAU);
    g.stroke();
    // The broken outer echo reads as a transmission, not a radar reach boundary.
    g.setLineDash([2, 7]);
    g.strokeStyle = rgba(color, (1 - k) * 0.24);
    g.beginPath();
    g.arc(0, 0, 14 + k * 44, 0, TAU);
    g.stroke();
    g.setLineDash([]);
  }
  g.shadowBlur = 0;
  g.strokeStyle = rgba(color, 0.75);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, -15);
  g.lineTo(0, -5);
  g.moveTo(-5, 0);
  g.lineTo(5, 0);
  g.stroke();
  const breath = 0.8 + Math.sin(clock / 1200 + phase) * 0.12;
  g.fillStyle = '#041019';
  g.strokeStyle = rgba(color, breath);
  g.lineWidth = 1.5;
  g.shadowColor = color;
  g.shadowBlur = glow ? 7 : 0;
  g.beginPath();
  g.moveTo(0, -32);
  g.lineTo(9, -23);
  g.lineTo(0, -14);
  g.lineTo(-9, -23);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = rgba(color, 0.95);
  g.beginPath();
  g.arc(0, -23, 2, 0, TAU);
  g.fill();
  g.restore();
}
