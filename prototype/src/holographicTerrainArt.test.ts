import { describe, expect, it, vi } from "vitest";
import { drawTerrainArt, terrainEdgeAlpha } from "./holographicTerrainArt";

const poly = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
] as const;
const field = {
  id: "C2R3",
  kind: "nebula",
  phase: 0.2,
  poly,
  box: { x: 0, y: 0, width: 100, height: 100 },
};
function recorder() {
  const strokes: { points: number[][]; alpha: number }[] = [];
  let points: number[][] = [];
  const context = {
    globalAlpha: 1,
    save() {},
    restore() {},
    clip() {},
    closePath() {},
    beginPath() {
      points = [];
    },
    moveTo(x: number, y: number) {
      points.push([x, y]);
    },
    lineTo(x: number, y: number) {
      points.push([x, y]);
    },
    stroke() {
      strokes.push({ points, alpha: this.globalAlpha });
    },
  };
  return { context: context as unknown as CanvasRenderingContext2D, strokes };
}

describe("terrain art respects province geometry", () => {
  it("fades shared borders continuously while retaining the interior volume", () => {
    expect(terrainEdgeAlpha(-1, 50, poly, 14)).toBe(0);
    expect(terrainEdgeAlpha(0, 50, poly, 14)).toBe(0);
    expect(terrainEdgeAlpha(7, 50, poly, 14)).toBeCloseTo(0.5);
    expect(terrainEdgeAlpha(14, 50, poly, 14)).toBe(1);
    expect(terrainEdgeAlpha(50, 50, poly, 14)).toBe(1);
    expect(terrainEdgeAlpha(99.999, 50, poly, 14)).toBeLessThan(0.00001);
  });
  it("does not leak into the empty notch of a concave province", () => {
    const concave = [
      [0, 0],
      [100, 0],
      [100, 40],
      [40, 40],
      [40, 100],
      [0, 100],
    ] as const;
    expect(terrainEdgeAlpha(50, 50, concave, 12)).toBe(0);
    expect(terrainEdgeAlpha(39, 60, concave, 12)).toBeGreaterThan(0);
    expect(terrainEdgeAlpha(39, 60, concave, 12)).toBeLessThan(0.1);
    expect(terrainEdgeAlpha(20, 60, concave, 12)).toBe(1);
  });
  it("has the same edge falloff after camera translation and zoom", () => {
    const transformed = poly.map(([x, y]) => [x * 3 + 41, y * 3 - 19] as const);
    expect(
      terrainEdgeAlpha(7 * 3 + 41, 50 * 3 - 19, transformed, 42),
    ).toBeCloseTo(terrainEdgeAlpha(7, 50, poly, 14));
  });
  it("leaves planetary bodies and unknown kinds to their original wire renderer", () => {
    const forbidden = new Proxy(
      {},
      {
        get() {
          throw new Error("body fallback must not draw");
        },
      },
    );
    for (const kind of ["planet", "empty", "void_station", "unknown"]) {
      expect(
        drawTerrainArt(forbidden as CanvasRenderingContext2D, {
          ...field,
          kind,
        }),
      ).toBe(false);
    }
  });
  it("draws schematic vectors without browser images, canvases or texture operations", () => {
    for (const kind of [
      "nebula",
      "dense_nebula",
      "ion_storm",
      "solar_flare",
      "graveyard",
      "debris_field",
      "dead_world",
      "asteroid",
    ]) {
      const r = recorder();
      expect(
        drawTerrainArt(r.context, {
          ...field,
          kind,
          asteroids: [
            {
              x: 28,
              y: 30,
              radius: 6,
              poly: [
                [22, 29],
                [27, 24],
                [34, 28],
                [31, 35],
                [25, 35],
              ],
            },
          ],
        }),
      ).toBe(true);
      expect(r.strokes.length).toBeGreaterThan(0);
      expect(r.strokes.every((s) => s.alpha > 0 && s.alpha <= 0.53)).toBe(true);
    }
  });
  it("keeps terrain geometry anchored through camera translation and zoom", () => {
    const before = recorder();
    const after = recorder();
    drawTerrainArt(before.context, field);
    drawTerrainArt(after.context, {
      ...field,
      poly: poly.map(([x, y]) => [x * 3 + 41, y * 3 - 19] as const),
      box: { x: 41, y: -19, width: 300, height: 300 },
    });
    expect(after.strokes.length).toBe(before.strokes.length);
    before.strokes.forEach((stroke, i) => {
      expect(after.strokes[i]!.alpha).toBeCloseTo(stroke.alpha);
      stroke.points.forEach(([x, y], j) => {
        expect(after.strokes[i]!.points[j]![0]).toBeCloseTo(x! * 3 + 41);
        expect(after.strokes[i]!.points[j]![1]).toBeCloseTo(y! * 3 - 19);
      });
    });
  });
  it("has a bounded live pass whose clock changes light but never terrain anchors", () => {
    const before = recorder();
    const after = recorder();
    drawTerrainArt(before.context, field, 0, true);
    drawTerrainArt(after.context, field, 8000, true);
    expect(before.strokes.length).toBe(4);
    expect(after.strokes.map((s) => s.points)).toEqual(
      before.strokes.map((s) => s.points),
    );
    expect(after.strokes.map((s) => s.alpha)).not.toEqual(
      before.strokes.map((s) => s.alpha),
    );
    const still = recorder();
    drawTerrainArt(still.context, { ...field, kind: "asteroid" }, 8000, true);
    expect(still.strokes).toEqual([]);
  });
  it("does not regenerate the full terrain for live glints after a fractional pan", () => {
    const original = { ...field, id: 'fractional-marker', marker: { x: 31.21, y: 47.13 } };
    drawTerrainArt(recorder().context, original);
    const hypot = vi.spyOn(Math, 'hypot');
    try {
      for (const [dx, dy] of [[.1, -.3], [178.273, -57.199], [-519.311, 391.222]]) {
        const translated = {
          ...original,
          marker: { x: original.marker.x + dx!, y: original.marker.y + dy! },
          box: { ...original.box, x: dx!, y: dy! },
          poly: poly.map(([x, y]) => [x + dx!, y + dy!] as const),
        };
        const r = recorder();
        drawTerrainArt(r.context, translated, 3000, true);
        expect(r.strokes).toHaveLength(4);
      }
      // Edge-distance subdivision belongs to the static geometry build, not the
      // four live highlights of a previously seen province.
      expect(hypot).not.toHaveBeenCalled();
    } finally { hypot.mockRestore(); }
  });
});
