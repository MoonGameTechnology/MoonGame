/**
 * Миры карты (REFM-235, часть 1): всё, что кадр рисует на самих узлах, — имена своих миров
 * на схеме, имена областей, искусство узла по типу сектора (сфера мира, поле астероидов,
 * туманность, буря, кладбище, мёртвый мир, станции и крепости), его бейдж типа, кольцо
 * радара, ряд построек и подпись, метки тумана и крепости на развилках дорог.
 *
 * Что показать, решают чистые модели (`fogView.ts`, `kindBadge.ts`, `buildChips.ts`,
 * `nodeCallout.ts`, `semanticZoom.ts`, `radarSources.ts`, `decisions/regionName.ts`); здесь
 * только холст. Мир, своё место, узлы карты, контекст кадра, часы и вид голограммы и тип
 * сектора модуль получает хуками {@link initMapWorlds}: они живут в `main.ts`, и импорт
 * оттуда был бы циклом. Слой зовёт кадр `render()`.
 */
import type { BuildingInstance, GameState } from '../../packages/shared-core/src/index';
import { isForkSite } from '../../packages/shared-core/src/index';
import { rgba } from '../../packages/client/src/holoDraw';
import { mapRegions } from '../../packages/client/src/gameData';
import { drawSchematicNode, type MapLod } from '../../packages/client/src/mapLod';
import { drawShipShape } from '../../packages/client/src/shipShapes';
import { t, tData } from '../../localization/runtime';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { regionLabelAlpha, regionLabels } from '../../decisions/regionName';
import { chipFontPx, chipGlyph, chipMetrics, chipXs, chipY, chipsShown } from './buildChips';
import { fleetAnchor } from './fleetGeometry';
import { nodeView } from './fogView';
import { data, hpOfLevel, type MapNode, type SECTOR_TYPES } from './game';
import { fxBlur, fxBreath } from './graphicsPrefs';
import { hasTerrainMaterial } from './holographicSurface';
import { BUILD_ICON, KIND_ICON } from './icons';
import { selFork, selPlanet } from './interaction';
import { BADGE_R, badgeBob, badgeCenterY, badgeLook, badgeShown, badgeTether } from './kindBadge';
import { visible, world } from './mapCamera';
import { fleetSeen, known, memory, seesDetails } from './mapFog';
import { roadDrawingOf } from './mapLayer';
import { targetBrackets } from './mapOverlays';
import { CARDINAL, TAU, blitGlow, blitSphere, ownerColor } from './mapPalette';
import { planetRadar } from './mapRadar';
import { asteroidsFor, polyPoints } from './mapShapes';
import { calloutInk, calloutLine, calloutTier } from './nodeCallout';
import { worldName } from './planetName';
import { phaseAt } from './pulseFx';
import { radarShown } from './radarSources';
import type { Snapshot } from './scanMemory';
import { artScale, calloutAlpha, sphereBloom } from './semanticZoom';
import { VOID_COLOR } from './sideColors';

/** Что мирам карты нужно от игры. */
export interface MapWorldsHost {
  /** Мир, который показывает кадр. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Узлы карты этого матча. */
  nodes(): readonly MapNode[];
  /** Контекст канваса карты. */
  ctx(): CanvasRenderingContext2D;
  /** Часы голограммы: стоят на паузе и при отключённой анимации. */
  clock(): number;
  /** Голографический вид карты. */
  holographic(): boolean;
  /** Тип сектора узла; `undefined` — узел не на карте. */
  sectorType(id: string): (typeof SECTOR_TYPES)[string] | undefined;
}

let game: MapWorldsHost;

/** Подключить миры карты к игре. */
export function initMapWorlds(host: MapWorldsHost): void {
  game = host;
}

const holographicMapOn = (): boolean => game.holographic();
const sectorTypeOf = (id: string): (typeof SECTOR_TYPES)[string] | undefined => game.sectorType(id);
/** Имя места — то же, что у журнала и окон (`planetName.ts`, UIX-5.2). */
const placeName = (id: string): string => worldName(game.world(), id);

/**
 * ИМЕНА ОБЛАСТЕЙ (M2.15, `decisions/regionName.ts`): проступают при отдалении, когда
 * внутренние границы растворяются, и гаснут, когда снова читаются провинции. Анимации нет —
 * прозрачность следует за масштабом, который задаёт игрок. У карты без областей не рисуется
 * ничего.
 */
function drawRegionLabels(lod: MapLod): void {
  const s = game.world();
  const cx = game.ctx();
  const alpha = regionLabelAlpha(lod.provinceDetail);
  if (alpha <= 0) return;
  const labels = regionLabels(s.mapId, mapRegions(s.mapId), (id) => s.planets[id]?.position);
  if (labels.length === 0) return;
  cx.save();
  cx.globalAlpha *= alpha;
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
  cx.lineJoin = 'round';
  for (const label of labels) {
    const c = world(label);
    if (!visible(c, 240)) continue;
    const text = label.text.toUpperCase();
    cx.lineWidth = 4;
    cx.strokeStyle = 'rgba(4,10,12,.85)';
    cx.strokeText(text, c.x, c.y);
    cx.fillStyle = 'rgba(214,236,244,.92)';
    cx.fillText(text, c.x, c.y);
  }
  cx.restore();
}

/** Draw a fogged system: a greyed last-known blip from memory, or an unexplored
 *  marker if it has never been identified. */
function drawFogMarker(c: { x: number; y: number }, id: string, mem: Snapshot | undefined, lod: MapLod): void {
  const cx = game.ctx();
  cx.save();
  if (lod.detail === 0) {
    drawSchematicNode(cx, c, lod.markerRadius);
    cx.restore();
    return;
  }
  if (mem) {
    const col = ownerColor(mem.owner);
    cx.setLineDash([2, 4]);
    cx.strokeStyle = rgba(col, 0.34);
    cx.lineWidth = 1;
    cx.beginPath();
    cx.arc(c.x, c.y, lod.markerRadius + (9 - lod.markerRadius) * lod.detail, 0, TAU);
    cx.stroke();
    cx.setLineDash([]);
    cx.fillStyle = rgba(col, 0.4);
    cx.beginPath();
    cx.arc(c.x, c.y, 1.6, 0, TAU);
    cx.fill();
    cx.globalAlpha *= lod.detail;
    cx.textAlign = 'left';
    cx.fillStyle = rgba(col, 0.5);
    cx.font = '700 11px ui-monospace,Menlo,monospace';
    cx.fillText(placeName(id), c.x + 13, c.y - 1);
    cx.fillStyle = 'rgba(120,140,150,0.45)';
    cx.font = '9px ui-monospace,Menlo,monospace';
    const icons = mem.buildings.map((b) => BUILD_ICON[b.type] ?? '▪').join('');
    // Словами, а не «G:4 ✦last» (UIX-5.4): у холста нет подсказки, которая расшифровала бы
    // букву, а ✦ — тот же знак, что у «Последних данных» в карточке мира.
    const stats = [t('map.callout.garrison', { n: mem.garrison }), icons, t('map.fog.old')];
    cx.fillText(stats.filter(Boolean).join(' '), c.x + 13, c.y + 10);
  } else {
    cx.strokeStyle = 'rgba(125,161,176,0.5)';
    cx.lineWidth = 1;
    cx.beginPath();
    cx.arc(c.x, c.y, lod.markerRadius + (6 - lod.markerRadius) * lod.detail, 0, TAU);
    cx.stroke();
    cx.globalAlpha *= lod.detail;
    cx.fillStyle = 'rgba(125,161,176,0.65)';
    cx.font = '9px ui-monospace,Menlo,monospace';
    cx.textAlign = 'center';
    cx.fillText('?', c.x, c.y + 3);
  }
  cx.restore();
}

/** A regular polygon path centred at (x,y) — fort/station containment marker.
 *  Точки считает `mapShapes.ts` (REFM-34); здесь только обводка. */
function poly(x: number, y: number, r: number, sides: number, rot = 0) {
  const cx = game.ctx();
  cx.beginPath();
  polyPoints(x, y, r, sides, rot).forEach((p, i) => {
    if (i) cx.lineTo(p.x, p.y);
    else cx.moveTo(p.x, p.y);
  });
  cx.closePath();
}

/**
 * Миры карты — проволочные метки узлов с кольцами радара и моноширинными подписями.
 * LOD: метка и всё экранное вокруг неё (аура, кольцо радара, бейджи, сфера, засечки)
 * рисуются в масштабе R×ns — 45% на схеме, чтобы дальние провинции не тонули в своих же
 * значках (жалоба владельца на APK: на минимальном зуме искусство узла, бейджи и эффекты
 * ложились друг на друга).
 */
export function drawWorlds(now: number, lod: MapLod): void {
  const s = game.world();
  const cx = game.ctx();
  const ME = game.me();
  const MAP = game.nodes();
  const hologramTime = game.clock();
  const detail = lod.detail;
  cx.textAlign = 'left';
  const ns = artScale(detail); // node scale: schematic → detail (тот же закон, что у залпа)
  const R = 13 * ns;
  if (lod.art < 1) {
    // The rings themselves are in the map layer (`paintMapLayer`); my worlds' names stay live.
    cx.save();
    cx.globalAlpha *= 1 - lod.art;
    for (const n of MAP) {
      const p = s.planets[n.id];
      if (!p || p.owner !== ME || !known(n.id) || n.sector !== 'planet') continue;
      const c = world(n);
      if (!visible(c, 10)) continue;
      cx.fillStyle = ownerColor(ME);
      cx.font = '700 12px ui-monospace,Menlo,monospace';
      cx.fillText(placeName(n.id), c.x + lod.markerRadius + 6, c.y - 1);
    }
    cx.restore();
  }
  drawRegionLabels(lod);
  /**
   * Силуэт КРЕПОСТИ: прозрачный орбитальный каркас и — у крепости с ядром — корпус и
   * полоса прочности ядра (FORT-5.2). Один рисунок на крепость на узле, пиратскую и
   * нейтральную базы и крепость на развилке (FORT-6.1): крепость одна и та же, другое у
   * неё только место, и вторая копия рисунка разошлась бы с первой на первой правке.
   * Пиратская и нейтральная базы ядра не несут — полосы у них просто нет.
   */
  // Где корпус крепости уже нарисует её ЮНИТ (`emplacement.ts`): там силуэт ниже
  // рисует только каркас и полосу ядра, иначе корпус лёг бы дважды.
  const fortressUnits = Object.values(s.fleets)
    .filter((f) => isEmplacementFleet(f, data) && fleetSeen(f))
    .map((f) => fleetAnchor(f))
    .filter((a): a is { x: number; y: number; ang: number } => !!a);
  const drawStationArt = (
    c: { x: number; y: number },
    col: string,
    buildings: readonly BuildingInstance[],
    R: number,
  ): void => {
    cx.save();
    cx.strokeStyle = rgba(col, 0.7);
    cx.lineWidth = 0.85;
    for (const offset of [-3 * ns, 3 * ns]) {
      cx.beginPath();
      cx.ellipse(c.x, c.y + offset, R, R * 0.45, 0, 0, TAU);
      cx.stroke();
    }
    cx.beginPath();
    for (const [dx, dy] of CARDINAL) {
      const x = c.x + dx * R;
      const y = c.y + dy * R * 0.45;
      cx.moveTo(x, y - 3 * ns);
      cx.lineTo(x, y + 3 * ns);
      cx.moveTo(c.x, c.y);
      cx.lineTo(c.x + dx * R * 1.2, c.y + dy * R * 0.6);
    }
    cx.moveTo(c.x, c.y - R);
    cx.lineTo(c.x, c.y + R * 0.7);
    cx.stroke();
    poly(c.x, c.y, R * 0.33, 6, Math.PI / 6);
    cx.stroke();
    cx.restore();
    const core = buildings.find((b) => b.type === 'starfort');
    if (core) {
      // Корпус — у юнита, если тот стоит здесь; каркас и полоса ядра остаются силуэту.
      if (!fortressUnits.some((a) => Math.hypot(a.x - c.x, a.y - c.y) < 4)) {
        cx.save();
        cx.strokeStyle = col;
        cx.lineWidth = 1.6;
        cx.shadowColor = col;
        cx.shadowBlur = fxBlur(8);
        cx.fillStyle = rgba(col, 0.24);
        cx.translate(c.x - 12, c.y - 12);
        drawShipShape(cx, 'station', detail > 0.5);
        cx.restore();
      }
      const frac = Math.max(0, Math.min(1, core.hp / hpOfLevel('starfort', core.level)));
      cx.fillStyle = 'rgba(2,9,13,.7)';
      cx.fillRect(c.x - 12, c.y - 22, 24, 3);
      cx.fillStyle = rgba(frac > 0.35 ? col : '#ff5a4d', 0.9);
      cx.fillRect(c.x - 12, c.y - 22, 24 * frac, 3);
    }
  };
  cx.save();
  cx.globalAlpha *= lod.art;
  if (lod.art > 0)
  for (const n of MAP) {
    const p = s.planets[n.id];
    if (!p) continue;
    const c = world(n);
    if (!visible(c, 110)) continue;
    // Variant B: fog hides capturable systems (void cells stay as pure geometry).
    // Какой вид у узла — `fogView.ts` (REFM-62): пустой всегда виден, неопознанный
    // показывается ПАМЯТЬЮ, никогда не виденный — знаком вопроса только вблизи.
    if (n.sector === 'black_hole') {
      cx.save();
      cx.fillStyle = '#03030a'; cx.strokeStyle = '#8764ce'; cx.lineWidth = 3;
      cx.beginPath(); cx.arc(c.x, c.y, 20 * ns, 0, TAU); cx.fill(); cx.stroke();
      cx.beginPath(); cx.ellipse(c.x, c.y, 31 * ns, 10 * ns, -0.3, 0, TAU); cx.stroke();
      cx.restore();
      continue;
    }
    const kn = known(n.id);
    const mem = memory.get(n.id);
    const view = nodeView({ sector: n.sector, identified: kn, remembered: !!mem });
    if (view === 'remembered' || view === 'unexplored') {
      drawFogMarker(c, n.id, mem, lod);
      continue;
    }
    const showOwner = p.owner;
    const col = ownerColor(p.owner);
    const ownerPulse = fxBreath(now, {
      period: 620,
      base: 0.64,
      amp: 0.36,
      phase: phaseAt(n.x, n.y),
    });

    // empty-space sector: just a faint survey marker at its centre (no city, no
    // capture) — it is only a node you travel through.
    if (n.sector === 'empty') {
      cx.save();
      cx.strokeStyle = rgba(VOID_COLOR, 0.5);
      cx.lineWidth = 1;
      cx.beginPath();
      for (const [dx, dy] of CARDINAL) {
        cx.moveTo(c.x + dx * 1.5, c.y + dy * 1.5);
        cx.lineTo(c.x + dx * 3.5, c.y + dy * 3.5);
      }
      cx.stroke();
      cx.fillStyle = rgba(VOID_COLOR, 0.6);
      cx.beginPath();
      cx.arc(c.x, c.y, 1, 0, TAU);
      cx.fill();
      cx.restore();
      continue;
    }

    // province-type badge — a holographic type icon that HOVERS above the province:
    // a projected hologram (soft glow halo + holo capsule ring + a faint projector
    // tether down to the node), gently bobbing in the sector-type colour so the type
    // reads at a glance regardless of the bespoke art below (planet / asteroid / …).
    // Висит ли бейдж, где именно и как выглядит — `kindBadge.ts` (REFM-121): он оторван
    // от узла, чтобы не слиться с искусством сектора, и потому обязан тянуть к нему луч
    // проектора; покачивание фазируется координатами узла, иначе вся карта дрожит в такт.
    if (!holographicMapOn() && badgeShown(!!KIND_ICON[n.sector], detail)) {
      const kc = sectorTypeOf(n.id)?.color ?? '#9fb6bd';
      const look = badgeLook();
      const nodeTop = c.y - R;
      const bx = c.x;
      const by = badgeCenterY(nodeTop, badgeBob(now, n.x, n.y));
      const tether = badgeTether(nodeTop, by);
      cx.save();
      cx.globalAlpha = detail; // LOD: the hologram dissolves on the schematic view
      blitGlow(kc, bx, by, look.glowRadius, look.glowAlpha); // holographic bloom (cached disc)
      // projector tether — a faint dashed beam from the node up to the badge
      cx.strokeStyle = rgba(kc, look.tetherAlpha);
      cx.setLineDash([...look.tetherDash]);
      cx.lineWidth = 1;
      cx.beginPath();
      cx.moveTo(bx, tether.from);
      cx.lineTo(bx, tether.to);
      cx.stroke();
      cx.setLineDash([]);
      // holo capsule: translucent disc + bright rim + inner scanline ring
      cx.fillStyle = rgba(kc, look.fillAlpha);
      cx.beginPath();
      cx.arc(bx, by, BADGE_R, 0, TAU);
      cx.fill();
      cx.strokeStyle = rgba(kc, look.rimAlpha);
      cx.lineWidth = look.rimWidth;
      cx.beginPath();
      cx.arc(bx, by, BADGE_R, 0, TAU);
      cx.stroke();
      cx.strokeStyle = rgba(kc, look.scanAlpha);
      cx.beginPath();
      cx.arc(bx, by, BADGE_R - look.scanInset, 0, TAU);
      cx.stroke();
      // the type glyph, glowing in the sector colour
      cx.font = '700 15px ui-monospace,Menlo,monospace';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.shadowColor = kc;
      cx.shadowBlur = fxBlur(look.glyphBlur);
      cx.fillStyle = rgba(kc, look.glyphAlpha);
      cx.fillText(KIND_ICON[n.sector]!, bx, by + 0.5);
      cx.restore();
    }

    // asteroid-field sector: a lane junction, not a city — scattered rocks + a
    // fat hub where the lanes meet, no orbits. Captured by simply arriving. Raising a
    // fortress here stops making it an asteroid field at all: `station.deploy` turns the
    // node into `void_station`, which draws (with its hull bar) in its own branch below.
    if ((n.sector === 'asteroid' || n.sector === 'asteroid_cluster') && !holographicMapOn()) {
      blitGlow(col, c.x, c.y, 30, p.owner ? 0.16 : 0.06); // cached glow disc
      cx.save();
      cx.strokeStyle = 'rgba(186,170,140,0.7)';
      cx.fillStyle = 'rgba(42,40,33,0.72)';
      cx.lineWidth = 1;
      for (const rk of asteroidsFor(n.id, n.x, n.y)) {
        cx.save();
        cx.translate(c.x + rk.dx, c.y + rk.dy);
        cx.rotate(rk.rot + now / 9000);
        cx.beginPath();
        for (let k = 0; k < rk.sides; k++) {
          const a = (k / rk.sides) * TAU;
          const rr = rk.r * (0.72 + 0.28 * Math.sin(a * 2 + rk.rot));
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr;
          if (k) cx.lineTo(px, py);
          else cx.moveTo(px, py);
        }
        cx.closePath();
        cx.fill();
        cx.stroke();
        cx.restore();
      }
      cx.restore();
      // fat junction hub (the lanes converge here), owner-coloured
      blitGlow(col, c.x, c.y, 13, p.owner ? 0.5 : 0.3); // cached bloom, not shadowBlur
      cx.fillStyle = rgba(col, 0.92);
      cx.beginPath();
      cx.arc(c.x, c.y, 4.2, 0, TAU);
      cx.fill();
      cx.strokeStyle = rgba(col, 0.75);
      cx.lineWidth = 1.3;
      cx.beginPath();
      cx.arc(c.x, c.y, 7.5 + 0.6 * ownerPulse, 0, TAU);
      cx.stroke();
      if (selPlanet === n.id) targetBrackets(c.x, c.y, 15, now);
      cx.save();
      cx.shadowColor = 'rgba(0,0,0,0.85)';
      cx.shadowBlur = fxBlur(3);
      // An asteroid field is a minor sector — de-emphasised (dim, smaller).
      cx.fillStyle = p.owner ? rgba(col, 0.72) : 'rgba(150,190,196,0.5)';
      cx.font = '600 10px ui-monospace,Menlo,monospace';
      cx.fillText(placeName(n.id), c.x + 16, c.y - 1);
      cx.fillStyle = 'rgba(150,210,205,0.38)';
      cx.font = '9px ui-monospace,Menlo,monospace';
      cx.fillText(tData(sectorTypeOf(n.id)?.name ?? 'Asteroid Field'), c.x + 16, c.y + 11);
      cx.restore();
      continue;
    }

    // territory aura — cached glow disc (no per-node gradient)
    blitGlow(col, c.x, c.y, R + 20 * ns, showOwner ? 0.13 : 0.045);

    // sensor-range ring (dashed, faint) — only where a radar actually stands (PVR-6.19):
    // drawn on every world it read as a radar the world doesn't have. Same gate as the
    // range finder (`radarShown`, rule 11), so it can't leak a hidden radar through fog.
    if (radarShown({ detailed: seesDetails(p), reach: planetRadar(p) })) {
      cx.save();
      cx.setLineDash([3, 5]);
      cx.lineDashOffset = -hologramTime / 240;
      cx.strokeStyle = rgba(col, 0.12 + 0.05 * ownerPulse);
      cx.lineWidth = 0.75;
      cx.beginPath();
      cx.arc(c.x, c.y, R + (14 + 2 * ownerPulse) * ns, 0, TAU);
      cx.stroke();
      cx.restore();
    }

    // fort = hex containment ring
    if (kn && p.buildings.some((b) => b.type === 'fort')) {
      cx.strokeStyle = rgba(col, 0.5);
      cx.lineWidth = 1;
      poly(c.x, c.y, R + 6 * ns, 6, Math.PI / 6);
      cx.stroke();
    }

    // building badges are detail-only: on the schematic view the province colour
    // and score already tell the story — a row of 10px chips just piles onto the
    // shrunken blip (the APK min-zoom overlap).
    // Раскладку ряда считает `buildChips.ts` (REFM-122): ряд ЦЕНТРИРОВАН под узлом (иначе
    // мир будто съезжает вбок при каждой достройке), сжимается вместе с маркером, а у
    // кегля есть пол — буква мельче семи пикселей читается как сор, а не как значок.
    if (chipsShown(kn, p.buildings.length, detail)) {
      cx.save();
      cx.globalAlpha = detail;
      cx.font = `${chipFontPx(ns)}px ui-monospace,Menlo,monospace`;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      const { half } = chipMetrics(ns);
      const xs = chipXs(p.buildings.length, c.x, ns);
      const by = chipY(c.y, R, ns);
      for (let i = 0; i < p.buildings.length; i++) {
        const b = p.buildings[i];
        if (!b) continue;
        const bx = xs[i]!;
        cx.fillStyle = 'rgba(2,9,13,.78)';
        cx.strokeStyle = rgba(col, 0.55);
        cx.lineWidth = 1;
        cx.beginPath();
        cx.rect(bx - half, by - half, half * 2, half * 2);
        cx.fill();
        cx.stroke();
        cx.fillStyle = rgba(col, 0.9);
        cx.fillText(chipGlyph(BUILD_ICON[b.type]), bx, by + 0.5);
      }
      cx.restore();
    }

    if (holographicMapOn() && hasTerrainMaterial(n.sector) &&
      n.sector !== 'dead_world' && n.sector !== 'planet' && n.sector !== 'void_station') {
      // Terrain is the province's material; retain a precise selectable survey point.
      cx.fillStyle = rgba(col, .7);
      cx.beginPath();
      cx.arc(c.x, c.y, 2.4, 0, TAU);
      cx.fill();
    } else if (n.sector === 'planet') {
      // A transparent rotating wire volume, with no opaque core obscuring its mesh.
      // The visual clock is independent of game speed and freezes on pause/reduced motion.
      blitSphere(col, c.x, c.y, R, Math.max(0.65, sphereBloom(lod.scale)), detail > 0 ? hologramTime + phaseAt(n.x, n.y) * 400 : 0);
      blitGlow(col, c.x, c.y, R + 7, showOwner ? 0.08 : 0.035);

      // N/E/S/W crosshair ticks
      cx.strokeStyle = rgba(col, 0.45);
      cx.lineWidth = 0.75;
      cx.beginPath();
      for (const [dx, dy] of CARDINAL) {
        cx.moveTo(c.x + dx * (R - 3), c.y + dy * (R - 3));
        cx.lineTo(c.x + dx * (R + 5), c.y + dy * (R + 5));
      }
      cx.stroke();
    } else if (n.sector === 'rift') {
      // Classic mode retains a compact split-seam marker for the new obstacle.
      cx.save();
      cx.strokeStyle = '#c7a0ed';
      cx.lineWidth = 1.3;
      for (const side of [-1, 1]) {
        cx.beginPath();
        cx.moveTo(c.x - R * .3 + side * 2, c.y - R);
        cx.lineTo(c.x + R * .18 + side * 4, c.y - R * .25);
        cx.lineTo(c.x - R * .18 + side * 4, c.y + R * .25);
        cx.lineTo(c.x + R * .3 + side * 2, c.y + R);
        cx.stroke();
      }
      cx.restore();
    } else if (n.sector === 'nebula' || n.sector === 'dense_nebula') {
      // Nebula: soft diamond (rotated square) with diffuse glow
      const kc = sectorTypeOf(n.id)?.color ?? col;
      const dr = R * 0.85;
      blitGlow(kc, c.x, c.y, R + 7, showOwner ? 0.2 : 0.1);
      cx.save();
      cx.strokeStyle = rgba(kc, 0.7);
      cx.fillStyle = rgba(kc, 0.12 + 0.08 * ownerPulse);
      cx.lineWidth = 1.6;
      cx.beginPath();
      cx.moveTo(c.x, c.y - dr);
      cx.lineTo(c.x + dr, c.y);
      cx.lineTo(c.x, c.y + dr);
      cx.lineTo(c.x - dr, c.y);
      cx.closePath();
      cx.fill();
      cx.stroke();
      // inner diamond (scanline effect)
      cx.strokeStyle = rgba(kc, 0.3);
      cx.lineWidth = 1;
      const ir = dr * 0.55;
      cx.beginPath();
      cx.moveTo(c.x, c.y - ir);
      cx.lineTo(c.x + ir, c.y);
      cx.lineTo(c.x, c.y + ir);
      cx.lineTo(c.x - ir, c.y);
      cx.closePath();
      cx.stroke();
      // core dot
      cx.fillStyle = rgba(kc, 0.7 + 0.3 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 2, 0, TAU);
      cx.fill();
      cx.restore();
    } else if (n.sector === 'ion_storm' || n.sector === 'solar_flare') {
      // Storm: spiky burst (6-pointed star)
      const kc = sectorTypeOf(n.id)?.color ?? col;
      const outerR = R * 0.9;
      const innerR = R * 0.4;
      const spikes = n.sector === 'ion_storm' ? 5 : 8;
      blitGlow(kc, c.x, c.y, R + 7, showOwner ? 0.22 : 0.1);
      cx.save();
      cx.strokeStyle = rgba(kc, 0.75);
      cx.fillStyle = rgba(kc, 0.1 + 0.06 * ownerPulse);
      cx.lineWidth = 1.4;
      cx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
        const rr = i % 2 === 0 ? outerR : innerR;
        if (i === 0) cx.moveTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
        else cx.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
      }
      cx.closePath();
      cx.fill();
      cx.stroke();
      // core dot
      cx.fillStyle = rgba(kc, 0.7 + 0.3 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 2, 0, TAU);
      cx.fill();
      cx.restore();
    } else if (n.sector === 'graveyard') {
      // Derelict Graveyard: scattered debris fragments around a dim hub
      const kc = sectorTypeOf(n.id)?.color ?? col;
      blitGlow(kc, c.x, c.y, R + 5, showOwner ? 0.16 : 0.06);
      cx.save();
      cx.strokeStyle = rgba(kc, 0.5);
      cx.lineWidth = 1.2;
      // scattered wreck fragments — short dashes at fixed angles
      const frags = [0, 0.7, 1.5, 2.3, 3.1, 4.0, 4.9, 5.6];
      for (const a of frags) {
        const r0 = 5 + 2 * Math.sin(a * 3.7);
        const r1 = 9 + 3 * Math.sin(a * 2.1 + 1);
        cx.beginPath();
        cx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0);
        cx.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
        cx.stroke();
      }
      // dim centre hub
      cx.fillStyle = rgba(kc, 0.5 + 0.2 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 3, 0, TAU);
      cx.fill();
      cx.strokeStyle = rgba(kc, 0.4);
      cx.beginPath();
      cx.arc(c.x, c.y, 7, 0, TAU);
      cx.stroke();
      cx.restore();
    } else if (n.sector === 'dead_world') {
      // Dead World: broken/dashed circle with an X through it
      const kc = sectorTypeOf(n.id)?.color ?? col;
      blitGlow(kc, c.x, c.y, R + 5, showOwner ? 0.16 : 0.08);
      cx.save();
      cx.setLineDash([4, 4]);
      cx.strokeStyle = rgba(kc, 0.6);
      cx.lineWidth = 1.6;
      cx.beginPath();
      cx.arc(c.x, c.y, R * 0.8, 0, TAU);
      cx.stroke();
      cx.setLineDash([]);
      // cross through the centre (the "dead" mark)
      const xr = R * 0.45;
      cx.strokeStyle = rgba(kc, 0.45);
      cx.lineWidth = 1.3;
      cx.beginPath();
      cx.moveTo(c.x - xr, c.y - xr);
      cx.lineTo(c.x + xr, c.y + xr);
      cx.moveTo(c.x + xr, c.y - xr);
      cx.lineTo(c.x - xr, c.y + xr);
      cx.stroke();
      // dim core dot
      cx.fillStyle = rgba(kc, 0.5 + 0.2 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 2, 0, TAU);
      cx.fill();
      cx.restore();
    } else if (['void_station', 'pirate_base', 'neutral_base'].includes(n.sector)) {
      drawStationArt(c, col, p.buildings, R);
    } else {
      // Fallback for any other non-planet type: small hexagon marker
      const kc = sectorTypeOf(n.id)?.color ?? col;
      blitGlow(kc, c.x, c.y, R + 5, showOwner ? 0.14 : 0.06);
      cx.save();
      cx.strokeStyle = rgba(kc, 0.55);
      cx.fillStyle = rgba(kc, 0.08);
      cx.lineWidth = 1.4;
      poly(c.x, c.y, R * 0.7, 6, Math.PI / 6);
      cx.fill();
      cx.stroke();
      cx.fillStyle = rgba(kc, 0.5 + 0.2 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 2, 0, TAU);
      cx.fill();
      cx.restore();
    }

    if (selPlanet === n.id) targetBrackets(c.x, c.y, R + 10, now);

    // callout: id + garrison/buildings, monospace. Worlds (planets — the capturable
    // prize) get a BRIGHT designation; every other sector is de-emphasised to a dim,
    // smaller coordinate so the map reads "worlds first".
    // LOD: callout text dissolves on the schematic view — except YOUR OWN worlds,
    // which stay labelled like city names on a globe (your anchor at any zoom).
    // Тир подписи, её чернила и судьба второй строки — `nodeCallout.ts` (REFM-117):
    // мир подписан ярче транзитного сектора, цвет владельца несёт РАЗВЕДДАННЫЕ, а
    // пустой тихий сектор молчит, чтобы не сорить «гарнизон 0» вдоль всего маршрута.
    // Сюда доходит только ОПОЗНАННЫЙ узел — неопознанный забрал `drawFogMarker` выше
    // по циклу (REFM-117.1), поэтому ветки «нет телеметрии» здесь больше нет.
    const tier = calloutTier(n.sector);
    const isWorld = tier === 'world';
    const mineWorld = isWorld && p.owner === ME;
    const callout = calloutAlpha(detail, mineWorld);
    if (callout === 0) continue;
    const g = p.garrison.reduce((a, st) => a + st.count, 0);
    const line = calloutLine({ detail, tier, garrison: g, buildings: p.buildings.length });
    const ink = calloutInk(!!p.owner);
    cx.save();
    cx.globalAlpha = callout;
    cx.shadowColor = 'rgba(0,0,0,0.85)';
    cx.shadowBlur = fxBlur(3);
    if (isWorld) {
      cx.fillStyle = ink === 'owner' ? col : '#9fc9c4';
      cx.font = '700 12px ui-monospace,Menlo,monospace';
    } else {
      cx.fillStyle = ink === 'owner' ? rgba(col, 0.72) : 'rgba(150,190,196,0.5)';
      cx.font = '600 10px ui-monospace,Menlo,monospace';
    }
    cx.fillText(placeName(n.id), c.x + R + 12, c.y - 1);
    if (line.do === 'stats') {
      const icons = p.buildings.map((b) => BUILD_ICON[b.type] ?? '▪').join('');
      cx.fillStyle = rgba('#96d2cd', isWorld ? 0.6 : 0.42);
      cx.font = isWorld ? '10px ui-monospace,Menlo,monospace' : '9px ui-monospace,Menlo,monospace';
      const stats = [t('map.callout.garrison', { n: g }), icons].filter(Boolean).join('  ');
      cx.fillText(stats, c.x + R + 12, c.y + (isWorld ? 12 : 11));
    }
    cx.restore();
  }

  // FORT-6.1: крепости на РАЗВИЛКАХ. Их площадок нет в `MAP` — это не узлы карты, а
  // сооружения на дороге, — поэтому они рисуются отдельным проходом по состоянию, тем же
  // силуэтом, что крепость на узле, только меньше: она стоит на тропе, а не в центре мира.
  // Чужая — только видимая: память о ней тумана не обходит (площадку зритель получает,
  // лишь увидев её). Выбранная развилка без крепости — рамкой вокруг ромба.
  if (lod.art > 0) {
    for (const p of Object.values(s.planets)) {
      if (!isForkSite(p) || p.owner === null || !(p.owner === ME || known(p.id))) continue;
      const c = world(p.position);
      if (!visible(c, 40)) continue;
      drawStationArt(c, ownerColor(p.owner), p.buildings, R * 0.7);
      if (selPlanet === p.id) targetBrackets(c.x, c.y, R, now);
    }
    if (selFork) {
      const mark = roadDrawingOf(s).marks.find(
        (m) => m.province === selFork!.province && m.trail === selFork!.trail,
      );
      if (mark) {
        const c = world(mark.at);
        targetBrackets(c.x, c.y, 10, now);
      }
    }
  }

  cx.restore();
}
