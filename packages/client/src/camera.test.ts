import { describe, it, expect } from 'vitest';
import {
  type Cam,
  type Viewport,
  type Bounds,
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  projectBase,
  projection,
  worldToScreen,
  screenToWorld,
  zoomAt,
  pinchAt,
  clampCam,
  centerOn,
  inView,
  panRange,
  elasticCam,
  elasticPull,
  dragCam,
  settleCam,
  ELASTIC_REACH,
} from './camera';

// A portrait play area and a square map — the prototype's typical shape.
const VP: Viewport = { left: 0, right: 400, top: 0, bottom: 800 };
const B: Bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe('camera — projection', () => {
  it('worldToScreen ↔ screenToWorld round-trip is identity', () => {
    const cam: Cam = { scale: 2.5, x: -37, y: 91 };
    for (const p of [
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
      { x: 412, y: 733 },
      { x: 999, y: 1 },
    ]) {
      const back = screenToWorld(worldToScreen(p, cam, VP, B), cam, VP, B);
      expect(near(back.x, p.x)).toBe(true);
      expect(near(back.y, p.y)).toBe(true);
    }
  });

  it('base fit preserves aspect (uniform scale) and centres the whole map', () => {
    // A square map in a 400×800 area fits to width (400), letterboxed vertically.
    const tl = projectBase({ x: 0, y: 0 }, VP, B);
    const br = projectBase({ x: 1000, y: 1000 }, VP, B);
    const w = br.x - tl.x;
    const h = br.y - tl.y;
    expect(near(w, h)).toBe(true); // square stays square
    expect(w).toBeLessThanOrEqual(400); // fits inside the play area
    expect(near((tl.x + br.x) / 2, 200)).toBe(true); // centred on X
    expect(near((tl.y + br.y) / 2, 400)).toBe(true); // centred on Y
  });

  it('projection gives the same screen point as worldToScreen, for an offset map too', () => {
    const b: Bounds = { minX: -2600, minY: 300, maxX: 5400, maxY: 4100 };
    const cam: Cam = { scale: 3.7, x: -1210.5, y: 388.25 };
    const pr = projection(cam, VP, b);
    for (const p of [
      { x: -2600, y: 300 },
      { x: 5400, y: 4100 },
      { x: 17, y: 2222 },
    ]) {
      const s = worldToScreen(p, cam, VP, b);
      expect(Math.abs(pr.a * p.x + pr.x - s.x)).toBeLessThan(1e-9);
      expect(Math.abs(pr.a * p.y + pr.y - s.y)).toBeLessThan(1e-9);
    }
  });
});

describe('camera — zoom', () => {
  it('moves the original pinch anchor with the midpoint, without accumulating clamped steps', () => {
    const cam = centerOn({ scale: 1, x: 0, y: 0 }, { x: 500, y: 500 }, 3, VP, B);
    const start = { dist: 100, mid: { x: 180, y: 350 } };
    const point = screenToWorld(start.mid, cam, VP, B);
    const mid = { x: 215, y: 390 };
    // Both finger event orders may briefly produce a different distance. Every
    // update must still be relative to the original gesture, including at the cap.
    for (const dist of [180, 240, 400, 210]) {
      const next = pinchAt(cam, start, { dist, mid }, VP, B);
      expect(next.scale).toBe(Math.min(6, (3 * dist) / 100));
      const projected = worldToScreen(point, next, VP, B);
      expect(projected.x).toBeCloseTo(mid.x, 6);
      expect(projected.y).toBeCloseTo(mid.y, 6);
    }
    expect(pinchAt(cam, start, start, VP, B)).toEqual(cam);
  });

  it('keeps two-finger translation at the zoom limit at constant scale', () => {
    const cam = centerOn({ scale: 1, x: 0, y: 0 }, { x: 500, y: 500 }, 6, VP, B);
    const start = { dist: 240, mid: { x: 200, y: 400 } };
    const next = pinchAt(cam, start, { dist: 240, mid: { x: 165, y: 435 } }, VP, B);
    expect(next).toEqual({ scale: 6, x: cam.x - 35, y: cam.y + 35 });
  });

  it('anchors the focal point: the map-space point under it stays put', () => {
    const cam0 = clampCam({ scale: 1, x: 0, y: 0 }, VP, B);
    const fx = 200;
    const fy = 400; // viewport centre → clamp won't fight the anchor
    const worldUnder = screenToWorld({ x: fx, y: fy }, cam0, VP, B);
    const cam1 = zoomAt(cam0, fx, fy, 2, VP, B);
    expect(cam1.scale).toBeCloseTo(2);
    const backOnScreen = worldToScreen(worldUnder, cam1, VP, B);
    expect(backOnScreen.x).toBeCloseTo(fx, 3);
    expect(backOnScreen.y).toBeCloseTo(fy, 3);
  });

  it('clamps scale to [MIN_SCALE, MAX_SCALE]', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(999)).toBe(MAX_SCALE);
    const zoomedOut = zoomAt({ scale: 1, x: 0, y: 0 }, 200, 400, 0.01, VP, B);
    expect(zoomedOut.scale).toBe(MIN_SCALE);
    const zoomedIn = zoomAt({ scale: 5, x: 0, y: 0 }, 200, 400, 10, VP, B);
    expect(zoomedIn.scale).toBe(MAX_SCALE);
  });
});

describe('camera — pan clamp & centring', () => {
  it('does not jump a slack-width when zoom crosses the viewport-fit threshold', () => {
    const threshold = 800 / 376; // scaled map height exactly fills the portrait viewport
    const before = clampCam({ scale: threshold - 0.00001, x: -200, y: -10000 }, VP, B);
    const after = clampCam({ scale: threshold + 0.00001, x: -200, y: -10000 }, VP, B);
    const anchor = { x: 500, y: 500 };
    const a = worldToScreen(anchor, before, VP, B);
    const b = worldToScreen(anchor, after, VP, B);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.02);
  });
  it('zoomed in, the outermost node can be pulled 30% of the play area in from the edge', () => {
    // Owner's ask 2026-10-24: let the camera fly a little further past the map edge.
    const left = clampCam({ scale: 5, x: 10_000, y: 10_000 }, VP, B);
    const tl = worldToScreen({ x: 0, y: 0 }, left, VP, B);
    expect(tl.x).toBeCloseTo(VP.left + 0.3 * 400, 6);
    expect(tl.y).toBeCloseTo(VP.top + 0.3 * 800, 6);
    const right = clampCam({ scale: 5, x: -10_000, y: -10_000 }, VP, B);
    const br = worldToScreen({ x: 1000, y: 1000 }, right, VP, B);
    expect(br.x).toBeCloseTo(VP.right - 0.3 * 400, 6);
    expect(br.y).toBeCloseTo(VP.bottom - 0.3 * 800, 6);
  });

  it('parks a smaller-than-viewport axis centred at the min-zoom floor', () => {
    const cam = clampCam({ scale: 1, x: 0, y: 0 }, VP, B);
    // At scale 1 the square map fits the 400px width → its centre sits at the play-area centre.
    const centre = worldToScreen({ x: 500, y: 500 }, cam, VP, B);
    expect(centre.x).toBeCloseTo(200, 3);
    expect(centre.y).toBeCloseTo(400, 3);
  });

  it('centerOn places a map point at the viewport centre', () => {
    const cam = centerOn({ scale: 1, x: 0, y: 0 }, { x: 250, y: 250 }, 4, VP, B);
    expect(cam.scale).toBe(4);
    const onScreen = worldToScreen({ x: 250, y: 250 }, cam, VP, B);
    expect(onScreen.x).toBeCloseTo(200, 3);
    expect(onScreen.y).toBeCloseTo(400, 3);
  });
});

describe('camera — edge slack (панель поверх карты)', () => {
  it('bottom slack widens the UP-drag range by exactly that many px when zoomed in', () => {
    // Zoomed in: the scaled map is taller than the play area → the y-range branch.
    const base = clampCam({ scale: 3, x: 0, y: -10_000 }, VP, B); // slam to the old floor
    const slacked = clampCam({ scale: 3, x: 0, y: -10_000 }, VP, B, { bottom: 300 });
    expect(slacked.y).toBeCloseTo(base.y - 300, 6); // 300px further up, no more
    expect(slacked.x).toBeCloseTo(base.x, 6); // x untouched by bottom slack
  });

  it('at the min-zoom fit the parked axis can be pulled up by the slack (and only it)', () => {
    // Scale 1: the square map letterboxes vertically → y normally PARKS centred.
    const parked = clampCam({ scale: 1, x: 0, y: 0 }, VP, B);
    const pulled = clampCam({ scale: 1, x: 0, y: parked.y - 10_000 }, VP, B, { bottom: 250 });
    expect(pulled.y).toBeCloseTo(parked.y - 250, 6); // freed by exactly the slack
    // Without slack the old parked behaviour is unchanged (regression guard).
    const still = clampCam({ scale: 1, x: 0, y: parked.y - 10_000 }, VP, B);
    expect(still.y).toBeCloseTo(parked.y, 6);
    // And slack only opens the covered side — dragging DOWN stays parked.
    const down = clampCam({ scale: 1, x: 0, y: parked.y + 10_000 }, VP, B, { bottom: 250 });
    expect(down.y).toBeCloseTo(parked.y, 6);
  });

  it('right slack widens the LEFT-drag range (right-hand panel layout)', () => {
    const base = clampCam({ scale: 3, x: -10_000, y: 0 }, VP, B);
    const slacked = clampCam({ scale: 3, x: -10_000, y: 0 }, VP, B, { right: 180 });
    expect(slacked.x).toBeCloseTo(base.x - 180, 6);
  });

  it('zoomAt and centerOn accept the slack (bounded wider, same anchor math)', () => {
    const viaZoom = zoomAt({ scale: 3, x: 0, y: -10_000 }, 200, 400, 1, VP, B, { bottom: 300 });
    expect(viaZoom.y).toBeCloseTo(clampCam({ scale: 3, x: 0, y: -10_000 }, VP, B).y - 300, 6);
    const c = centerOn({ scale: 1, x: 0, y: 0 }, { x: 500, y: 1000 }, 3, VP, B, { bottom: 300 });
    const noSlack = centerOn({ scale: 1, x: 0, y: 0 }, { x: 500, y: 1000 }, 3, VP, B);
    expect(c.y).toBeLessThan(noSlack.y); // the bottom-edge target gets closer to centre
  });
});

describe('camera — elastic edge (упругий край)', () => {
  // Owner's ask 2026-10-25: at the map border the camera "hit a wall".
  const reachX = 400 * ELASTIC_REACH;
  const atLeftEdge = (): Cam => {
    const r = panRange(3, VP, B);
    return { scale: 3, x: r.maxX, y: (r.minY + r.maxY) / 2 };
  };

  it('inside the pan range the map follows the finger one to one', () => {
    const r = panRange(3, VP, B);
    const mid: Cam = { scale: 3, x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
    expect(dragCam(mid, 25, -40, VP, B)).toEqual({ scale: 3, x: mid.x + 25, y: mid.y - 40 });
  });

  it('past the range the map still moves, slower the further it is pulled, never past the reach', () => {
    const edge = atLeftEdge();
    const one = dragCam(edge, 60, 0, VP, B);
    const two = dragCam(one, 60, 0, VP, B);
    expect(one.x).toBeGreaterThan(edge.x); // no wall: the camera moves past the range
    expect(one.x - edge.x).toBeLessThan(60); // ...but less than the finger
    expect(two.x - one.x).toBeLessThan(one.x - edge.x); // resistance grows
    const far = dragCam(edge, 100_000, 0, VP, B);
    expect(far.x - edge.x).toBeLessThan(reachX);
    expect(far.x - edge.x).toBeGreaterThan(reachX * 0.95);
  });

  it('pulling back the same way returns the camera exactly where it was', () => {
    const r = panRange(3, VP, B);
    const start: Cam = { scale: 3, x: r.maxX - 20, y: r.minY + 10 };
    const out = dragCam(start, 300, -300, VP, B);
    const back = dragCam(out, -300, 300, VP, B);
    expect(back.x).toBeCloseTo(start.x, 6);
    expect(back.y).toBeCloseTo(start.y, 6);
  });

  it('a gesture that grabs a stretched camera starts where it is, without a jump', () => {
    const stretched = dragCam(atLeftEdge(), 200, 0, VP, B);
    expect(dragCam(stretched, 0, 0, VP, B).x).toBeCloseTo(stretched.x, 6);
    expect(elasticCam(elasticPull(stretched, VP, B), VP, B).x).toBeCloseTo(stretched.x, 6);
    // A pinch that begins on it (zero movement) leaves it in place too.
    const pair = { dist: 120, mid: { x: 200, y: 400 } };
    const pinched = pinchAt(elasticPull(stretched, VP, B), pair, pair, VP, B, {}, elasticCam);
    expect(pinched.x).toBeCloseTo(stretched.x, 6);
  });

  it('a pinch past the edge stretches with the elastic edge and stays hard by default', () => {
    const edge = atLeftEdge();
    const start = { dist: 120, mid: { x: 200, y: 400 } };
    const moved = { dist: 120, mid: { x: 500, y: 400 } };
    expect(pinchAt(edge, start, moved, VP, B).x).toBeCloseTo(edge.x, 6);
    const soft = pinchAt(edge, start, moved, VP, B, {}, elasticCam);
    expect(soft.x).toBeGreaterThan(edge.x);
    expect(soft.x - edge.x).toBeLessThan(300);
  });

  it('released, the camera eases back into range and lands exactly on it', () => {
    let cur = dragCam(atLeftEdge(), 400, 0, VP, B);
    const target = clampCam(cur, VP, B);
    let prev = Math.abs(cur.x - target.x);
    let frames = 0;
    for (let done = false; !done; frames++) {
      const step = settleCam(cur, 16, VP, B);
      cur = step.cam;
      done = step.done;
      const gap = Math.abs(cur.x - target.x);
      expect(gap).toBeLessThanOrEqual(prev); // never overshoots back the other way
      prev = gap;
    }
    expect(cur).toEqual(target);
    expect(frames).toBeLessThan(30); // under half a second at 60 fps
  });

  it('a camera at rest inside the range is already settled', () => {
    const cam = clampCam({ scale: 2, x: 0, y: 0 }, VP, B);
    expect(settleCam(cam, 16, VP, B)).toEqual({ cam, done: true });
  });
});

describe('camera — cull', () => {
  it('inView respects the padded viewport', () => {
    expect(inView({ x: 200, y: 400 }, 400, 800, 80)).toBe(true);
    expect(inView({ x: -100, y: 400 }, 400, 800, 80)).toBe(false);
    expect(inView({ x: -20, y: 400 }, 400, 800, 80)).toBe(true); // within pad
    expect(inView({ x: 460, y: 400 }, 400, 800, 80)).toBe(true); // within pad
  });
});


it('zooms a large map to province detail while retaining the same focal point', () => {
  const bounds = { minX: 0, minY: 0, maxX: 10000, maxY: 10000 };
  const start = { scale: 1, x: 0, y: 0 };
  const focus = { x: 200, y: 400 };
  const before = screenToWorld(focus, start, VP, bounds);
  const zoomed = zoomAt(start, focus.x, focus.y, 30, VP, bounds);
  expect(zoomed.scale).toBe(30);
  const after = screenToWorld(focus, zoomed, VP, bounds);
  expect(near(before.x, after.x) && near(before.y, after.y)).toBe(true);
});
