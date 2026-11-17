/**
 * The black hole's node, drawn over its province in the map's line hand: a dark event
 * horizon in a violet ring, the bright photon ring just outside it, a tilted accretion disk of
 * three dashed rings that run round the hole (the back halves dim, the front halves crossing
 * the horizon bright), and lensing rings that leave the hole and fade. `clockMs` is the map's
 * visual clock: it freezes on pause and under reduced motion, and the hole then stands still.
 */
const TAU = Math.PI * 2;
const TILT = -0.25;
const DISK = '255,178,107';

export function drawBlackHole(cx: CanvasRenderingContext2D, x: number, y: number, r: number, clockMs = 0): void {
  const t = clockMs / 1000;
  cx.save();
  cx.lineCap = 'round';
  // Lensing: rings leave the hole and fade, slowly.
  cx.lineWidth = 1;
  for (let k = 0; k < 5; k++) {
    const f = ((k + t * 0.12) % 5) / 5;
    cx.strokeStyle = `rgba(169,139,255,${0.3 * (1 - f)})`;
    cx.beginPath();
    cx.arc(x, y, r * (1.2 + 2 * f), 0, TAU);
    cx.stroke();
  }
  // The horizon: nothing comes back.
  cx.fillStyle = '#020207';
  cx.beginPath();
  cx.arc(x, y, r, 0, TAU);
  cx.fill();
  // The disk; inner rings run faster, as orbits do.
  const disk = (front: boolean): void => {
    [1.9, 2.35, 2.8].forEach((m, i) => {
      cx.setLineDash([5 + i * 2, 4]);
      cx.lineDashOffset = -t * (16 - i * 4);
      cx.strokeStyle = `rgba(${DISK},${front ? 0.9 - i * 0.15 : 0.28})`;
      cx.lineWidth = front ? 1.1 : 0.8;
      cx.beginPath();
      cx.ellipse(x, y, r * m, r * m * 0.3, TILT, front ? 0 : Math.PI, front ? Math.PI : TAU);
      cx.stroke();
    });
    cx.setLineDash([]);
  };
  disk(false);
  cx.strokeStyle = '#a98bff';
  cx.lineWidth = 1.4;
  cx.beginPath();
  cx.arc(x, y, r, 0, TAU);
  cx.stroke();
  // Photon ring: light orbiting just outside the horizon.
  cx.strokeStyle = 'rgba(217,204,255,0.9)';
  cx.lineWidth = 0.8;
  cx.beginPath();
  cx.arc(x, y, r * 1.12, 0, TAU);
  cx.stroke();
  disk(true);
  cx.restore();
}
