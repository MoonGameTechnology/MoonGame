/**
 * The black hole's node, drawn over its province: a dark event horizon, the bright photon
 * ring round it, and a tilted sliver of disk whose approaching side is brighter (Doppler
 * beaming) — the look of the Abyss on every map that has a hole.
 */
const TAU = Math.PI * 2;
const TILT = -0.3;

export function drawBlackHole(cx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  cx.save();
  // Back half of the disk, seen above the hole: dim, bent over the top by the lensing.
  cx.lineCap = 'round';
  cx.strokeStyle = 'rgba(255, 170, 96, 0.35)';
  cx.lineWidth = r * 0.16;
  cx.beginPath();
  cx.ellipse(x, y, r * 1.75, r * 0.5, TILT, Math.PI, TAU);
  cx.stroke();
  // Glow of the photon ring.
  const glow = cx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.6);
  glow.addColorStop(0, 'rgba(169, 139, 255, 0.45)');
  glow.addColorStop(1, 'rgba(169, 139, 255, 0)');
  cx.fillStyle = glow;
  cx.beginPath();
  cx.arc(x, y, r * 1.6, 0, TAU);
  cx.fill();
  // The horizon: nothing comes back.
  cx.fillStyle = '#020207';
  cx.beginPath();
  cx.arc(x, y, r, 0, TAU);
  cx.fill();
  // Photon ring: light orbiting just outside the horizon.
  cx.strokeStyle = '#d9ccff';
  cx.lineWidth = Math.max(1.2, r * 0.09);
  cx.beginPath();
  cx.arc(x, y, r * 1.04, 0, TAU);
  cx.stroke();
  // Front half of the disk, across the hole: the approaching side (left) burns brighter.
  const front = cx.createLinearGradient(x - r * 1.8, y, x + r * 1.8, y);
  front.addColorStop(0, 'rgba(255, 236, 200, 0.95)');
  front.addColorStop(0.5, 'rgba(255, 178, 107, 0.8)');
  front.addColorStop(1, 'rgba(200, 90, 60, 0.45)');
  cx.strokeStyle = front;
  cx.lineWidth = r * 0.22;
  cx.beginPath();
  cx.ellipse(x, y, r * 1.75, r * 0.5, TILT, 0, Math.PI);
  cx.stroke();
  cx.restore();
}
