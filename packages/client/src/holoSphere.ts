/** Unit-sphere wire geometry. Baked into a small sprite atlas, never rebuilt per node/frame. */
const TAU = Math.PI * 2;
export const SPHERE_FRAMES = 16;
const MERIDIANS = 8;

export type WireSegment = readonly [number, number, number, number];
export interface SphereWire {
  front: WireSegment[];
  back: WireSegment[];
}

/** One meridian-spacing cycle; eight cycles make a complete 12.288s revolution. */
export function sphereFrame(timeMs: number): number {
  return ((Math.floor(timeMs / 96) % SPHERE_FRAMES) + SPHERE_FRAMES) % SPHERE_FRAMES;
}

/** Orthographic projection with a tilted axis; depth selects the front/back line weight. */
export function sphereWire(frame: number): SphereWire {
  const wire: SphereWire = { front: [], back: [] };
  const phase = (frame / SPHERE_FRAMES) * (TAU / MERIDIANS);
  const project = (lat: number, lon: number): readonly [number, number, number] => {
    const x = Math.cos(lat) * Math.sin(lon);
    const y = Math.sin(lat);
    const z = Math.cos(lat) * Math.cos(lon);
    const py = y * Math.cos(0.3) - z * Math.sin(0.3);
    const pz = y * Math.sin(0.3) + z * Math.cos(0.3);
    return [
      x * Math.cos(-0.18) - py * Math.sin(-0.18),
      x * Math.sin(-0.18) + py * Math.cos(-0.18),
      pz,
    ];
  };
  const line = (points: Array<readonly [number, number, number]>): void => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const side = a[2] + b[2] >= 0 ? wire.front : wire.back;
      side.push([a[0], a[1], b[0], b[1]]);
    }
  };
  for (let m = 0; m < MERIDIANS; m++) {
    line(
      Array.from({ length: 25 }, (_, i) =>
        project(-Math.PI / 2 + (i / 24) * Math.PI, phase + (m / MERIDIANS) * TAU),
      ),
    );
  }
  for (const lat of [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3]) {
    line(Array.from({ length: 49 }, (_, i) => project(lat, (i / 48) * TAU)));
  }
  return wire;
}
