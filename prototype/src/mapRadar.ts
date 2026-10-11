/**
 * Радар на карте (REFM-239): развёртка, контакты, которые она красит, и обе картины
 * дальности. Лучи своих радаров и их угол (`drawScanSweep`, `ownRadarSources`, яркость
 * засветки `sweepGlow`), контакты (`updateRadarContacts`, `drawRadarContacts`, метка
 * сигнатуры `drawSignatureAt`), дальность флота и мира (`fleetRadar`, `planetRadar`),
 * сводная граница обзора (`drawRadarCoverage`) и дальномер выбранного мира
 * (`drawRadarRange`).
 *
 * Модуль — владелец состояния радара. Память контактов развёртки снаружи только для чтения,
 * её сбрасывает дверь {@link forgetRadarContacts} (смена матча). Сетевые сигнатуры кладёт
 * дверь {@link takeNetSignatures} (снимок сервера), прозрачность хрома развёртки —
 * {@link setSweepOpacity} (настройки). `main.ts` читает их живыми привязками
 * (`export let`): присвоить мимо владельца не даст компилятор.
 *
 * Мир, своё место, канвас, размер экрана, кэш кадра, лента, имя места и звук живут в
 * `main.ts`; модуль получает их хуками {@link initMapRadar} — импорт оттуда был бы циклом.
 */
import {
  fleetRadarReach,
  sightRulesOf,
  worldRadarReach,
  type Fleet,
  type GameState,
  type Planet,
  type SightCircle,
  type SignatureContact,
} from '../../packages/shared-core/src/index';
import { rgba } from '../../packages/client/src/holoDraw';
import { t } from '../../localization/runtime';
import { contactAlpha, contactLost, paintedThisFrame } from './alerts';
import { drawSightFrontier } from './drawSightFrontier';
import { fleetPos, selectedFleetIds } from './fleetGeometry';
import { data } from './gameData';
import { fxBlur, fxBreath } from './graphicsPrefs';
import { selPlanet } from './interaction';
import { visible, world, worldDist } from './mapCamera';
import { known, seesDetails, vision } from './mapFog';
import { LOCK, TAU } from './mapPalette';
import { readNum, writeRaw } from './prefs';
import { netContacts } from './radarContacts';
import { mergeArms, rangeRings, sweepChromeShown } from './radarSources';
import { planetRadar as corePlanetRadar } from './sensorScale';
import { ownRingLook, ownRingShown, type SightTier } from './sightFrontier';
import { sweepGlow as armsGlow } from './sweepFx';

/** Что радару нужно от игры. Мир, канвас, кэш кадра, лента и звук живут в `main.ts`. */
export interface MapRadarHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Контекст канваса карты. */
  ctx(): CanvasRenderingContext2D;
  /** Ширина экрана в CSS-пикселях: граница обзора рисуется без маски размером с экран. */
  vw(): number;
  /** Высота экрана в CSS-пикселях. */
  vh(): number;
  /** Плотность экрана: края плиток границы обзора встают на целые физические пиксели. */
  dpr(): number;
  /** Свои источники развёртки с дальностью — из кэша кадра (`perWorld`), раз на мир. */
  sources(): RadarSources;
  /** Круги обзора блока зрения — из кэша кадра, те же, по которым ядро считает туман. */
  sight(): SightCircle[];
  /** Строка в ленту: развёртка впервые засекла контакт. */
  note(text: string, at?: string): void;
  /** Имя места для игрока. */
  placeName(id: string): string;
  /** Пинг гидролокатора: рука засекла контакт в этом кадре. */
  ping(): void;
}

let game: MapRadarHost;

/** Поднять радар: хуки игры. Зовётся из `main.ts` один раз, до первого кадра. */
export function initMapRadar(host: MapRadarHost): void {
  game = host;
}

// The backdrop (deep-space + nebulae + radar grid + star ticks) is part of the cached
// static layer (see paintSky / blitStaticLayer). This is the only live backdrop bit:
// a slow radar sweep across the plotting table — console chrome that follows the
// HARDWARE: one rotating arm per OWN radar source (planet array / radar ship),
// pivoted on the source and clipped to ITS reach; co-located sources collapse into
// one arm showing only the farthest radius. All arms share one rotation phase; map
// blips light up as an arm crosses them (radar "ping" afterglow). sweepOn guards
// engines without conic gradients (no visible sweep → no ping).
type SweepArm = { x: number; y: number; r: number }; // screen-space pivot + reach
export let sweepArms: SweepArm[] = [];
let sweepAng = 0;
export let sweepOn = false;
let sweepPrevAng = -1; // previous frame's arm angle, for "did the arm cross X" tests
// Player display preference (client-only, localStorage): the sweep's VISUAL opacity 0..1.
// 0 hides the wedge + arm entirely; any value only dims the CHROME — the radar MECHANIC
// (contact snapshots + blip afterglow) is computed before the visual gate, so it is
// unaffected at every setting. Absent key ⇒ full (1); a stored 0 must NOT be read as absent.
export let sweepOpacity = readNum('void.sweepOpacity', 1, 0, 1);
export function setSweepOpacity(v: number): void {
  sweepOpacity = Math.min(1, Math.max(0, v));
  writeRaw('void.sweepOpacity', String(sweepOpacity));
}

export const SWEEP_DIV = 1600; // sweep angular rate: ang = now / SWEEP_DIV
export const SWEEP_PERIOD = TAU * SWEEP_DIV; // ms for a full rotation (~10s) — the radar refresh tick
/** Один контакт, засеченный развёрткой: где и какого размера, и когда рука его красила. */
interface RadarMark {
  node: string;
  size: 'S' | 'M' | 'L';
  at: number;
  position?: { x: number; y: number };
}
/** Radar contacts as PAINTED BY THE SWEEP: a signature is refreshed only as the arm
 *  crosses it, then lingers at that last-swept spot (a dim ghost) until the next
 *  pass repaints it — so radar gives periodic snapshots, never a live feed. */
const radarMemory = new Map<string, RadarMark>();
/** Память контактов снаружи — только для чтения: сбрасывает её {@link forgetRadarContacts}. */
export const paintedContacts: ReadonlyMap<string, RadarMark> = radarMemory;
/** Забыть контакты развёртки: они принадлежат карте СТАРОГО матча (смена матча). */
export function forgetRadarContacts(): void {
  radarMemory.clear();
}
/** NET radar picture (BF-18): the server's per-frame contact list. In a network
 *  match the fogged state carries NO radar-only enemy fleets, so the sweep paints
 *  these server-sent contacts instead of scanning `s.fleets`. */
export let netSignatures: SignatureContact[] = [];
/** Положить контакты снимка сервера: они живут ровно один снимок (`snapshotIngest.ts`). */
export function takeNetSignatures(contacts: Iterable<SignatureContact>): void {
  netSignatures = [...contacts];
}

/** How brightly a contact at screen-point `c` is lit by the sweep: 1 the instant
 *  the arm crosses it, fading linearly back to 0 just before the next pass (so the
 *  imprint lingers a whole rotation). 0 when the sweep is inactive. */
export function sweepGlow(c: { x: number; y: number }): number {
  // Сама засветка (угол отставания, приведение знака, кривая, максимум по лучам) —
  // `sweepFx.ts` (REFM-113). Здесь остаётся только «есть ли развёртка вообще».
  return sweepOn ? armsGlow(sweepArms, c, sweepAng, TAU) : 0;
}

/** Свои источники радарной развёртки с дальностью: миры и флоты, у которых радар есть. */
export interface RadarSources {
  worlds: Array<{ at: { x: number; y: number }; reach: number }>;
  fleets: Array<{ fleet: Fleet; reach: number }>;
}
export function ownRadarSources(): RadarSources {
  const s = game.world();
  const ME = game.me();
  const worlds: RadarSources['worlds'] = [];
  for (const p of Object.values(s.planets)) {
    if (p.owner !== ME) continue;
    const reach = planetRadar(p);
    if (reach > 0) worlds.push({ at: p.position, reach });
  }
  const fleets: RadarSources['fleets'] = [];
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== ME) continue;
    const reach = fleetRadar(f);
    if (reach > 0) fleets.push({ fleet: f, reach });
  }
  return { worlds, fleets };
}

export function drawScanSweep(now: number) {
  const cx = game.ctx();
  sweepArms = [];
  sweepOn = false;
  if (!cx.createConicGradient) return; // graceful: skip on engines without it
  // One arm per OWN radar source, pivoted on the array / the ship itself (a moving
  // ship carries its arm along). Sources sharing a pivot (a radar world with a
  // radar ship docked) merge — only the farthest radius is shown.
  const raw: SweepArm[] = [];
  const add = (at: { x: number; y: number }, reach: number): void => {
    const c = world(at);
    const r = worldDist(reach); // uniform projection ⇒ true circle (`mapRadius.ts`)
    raw.push({ x: c.x, y: c.y, r });
  };
  // Дальности — из памяти по миру (шаг 9 плавности), а положение флота — каждым кадром.
  const radar = game.sources();
  for (const w of radar.worlds) add(w.at, w.reach);
  for (const { fleet, reach } of radar.fleets) {
    const pos = fleetPos(fleet);
    if (pos) add(pos, reach);
  }
  // Слияние совпавших по месту источников (остаётся ДАЛЬНИЙ) — `radarSources.ts`
  // (REFM-119): радарный корабль у радарного мира иначе дал бы два луча из одной точки.
  sweepArms = mergeArms(raw);
  sweepAng = (now / SWEEP_DIV) % TAU;
  sweepOn = sweepArms.length > 0;
  if (!sweepOn) return;
  // Visual gate (player preference). Everything above — arms, angle, sweepOn — is the
  // MECHANIC and always runs; only the chrome below is skipped/dimmed. At 0 the sweep is
  // invisible yet still snapshots contacts and lights blips exactly as before.
  // Механика (лучи, угол, `sweepOn`) уже посчитана выше и от настройки не зависит —
  // прозрачность гасит только ХРОМ (`radarSources.ts`, правило 10).
  const op = sweepOpacity;
  if (!sweepChromeShown(op)) return;
  cx.save();
  cx.globalCompositeOperation = 'lighter';
  for (const a of sweepArms) {
    if (!visible(a, a.r + 40)) continue; // draw-cull; the arm still paints contacts
    // subtle trailing wedge, clipped to this source's reach — reads as a slow
    // rotating radar sweep (fades over ~0.4 turn behind the leading edge). Alpha is
    // scaled by the player's opacity preference so it can be dimmed toward invisible.
    const grd = cx.createConicGradient(sweepAng, a.x, a.y);
    grd.addColorStop(0, `rgba(53,214,230,${0.05 * op})`);
    grd.addColorStop(0.16, `rgba(53,214,230,${0.012 * op})`);
    grd.addColorStop(0.4, 'rgba(53,214,230,0)');
    grd.addColorStop(1, 'rgba(53,214,230,0)');
    cx.save();
    cx.beginPath();
    cx.arc(a.x, a.y, a.r, 0, TAU);
    cx.clip();
    cx.fillStyle = grd;
    cx.fillRect(a.x - a.r, a.y - a.r, a.r * 2, a.r * 2);
    cx.restore();
    // the leading edge — the visible radar arm itself
    cx.strokeStyle = `rgba(53,214,230,${0.26 * op})`;
    cx.lineWidth = 1;
    cx.beginPath();
    cx.moveTo(a.x, a.y);
    cx.lineTo(a.x + Math.cos(sweepAng) * a.r, a.y + Math.sin(sweepAng) * a.r);
    cx.stroke();
  }
  cx.restore();
}

/** Refresh radar contacts the arm crossed this frame: snapshot each radar-only enemy
 *  fleet's spot + coarse size when the sweep paints it. Runs every frame. */
export function updateRadarContacts(now: number): void {
  if (!sweepOn) return;
  if (vision) {
    const s = game.world();
    // Both modes consume the same core projection: sensitivity and grouping are
    // decided before a sweep paints the anonymous contact.
    const contacts = netContacts(vision.signatures, known);
    let hit = false; // засекла ли рука хоть кого-то в ЭТОМ кадре
    for (const c of contacts) {
      const node = s.planets[c.node];
      if (!node) continue;
      const pos = world(c.position ?? node.position);
      // painted only by an arm whose radar disc actually covers the blip
      // Красит только рука, чей радарный диск реально накрывает отметку (`alerts.ts`).
      if (paintedThisFrame(sweepArms, pos, sweepPrevAng, sweepAng)) {
        hit = true;
        if (!radarMemory.has(c.key))
          game.note(t('threat.contact', { size: c.size, at: game.placeName(c.node) }), c.node);
        radarMemory.set(c.key, {
          node: c.node,
          size: c.size,
          at: now,
          ...(c.position ? { position: { ...c.position } } : {}),
        });
      }
    }
    // Пинг гидролокатора в момент засечки. ОДИН на кадр, а не на контакт: рука
    // пересекает несколько целей разом, и «пачка» звучала бы как сбой, а не как радар
    // (анти-трель зазор в `SOUND_MIN_GAP` прореживает и сами кадры).
    //
    // Звук намеренно НЕ смотрит на `sweepOpacity`: тот гасит только хром развёртки, а
    // засечка — событие механики, у него своя ручка (общий выключатель звука).
    if (hit) game.ping();
  }
  sweepPrevAng = sweepAng;
}

/** Draw the remembered radar contacts: a bright flash when freshly swept, settling
 *  to a dim last-known ghost held until the next pass repaints it; dropped once a full
 *  rotation passes with no repaint (the contact has moved on / is gone). */
export function drawRadarContacts(now: number): void {
  const s = game.world();
  for (const [id, m] of radarMemory) {
    const age = now - m.at;
    if (contactLost(age, SWEEP_PERIOD)) {
      radarMemory.delete(id); // a whole turn with no repaint → contact lost
      continue;
    }
    const node = s.planets[m.node];
    if (!node) {
      radarMemory.delete(id);
      continue;
    }
    const pos = world(m.position ?? node.position);
    if (!visible(pos, 120)) continue;
    drawSignatureAt(pos, m.size, contactAlpha(age), now);
  }
}

// --- radar / signatures ------------------------------------------------------
// Radar reach + per-unit "loudness" are DATA, read straight from the content
// (`data.buildings[t].radarRange`, `data.units[u].radarRange`/`signature`) — the
// SAME source the core fog (`visibility.ts`) reads, so single-player and the
// networked view agree by construction, with no mirrored constants to drift. The
// reach values themselves (and why a radar must clear your border to the next ring
// of worlds to yield any signature) are tuned in the content, next to the data.
// A radar projects two concentric ranges: signatures out to its full reach, and
// full identification within the inner half (mirrors shared-core visibility).
const IDENTIFY_REACH_FRACTION = 0.5;

/** Radar reach (distance) a fleet projects, from its loudest radar-ship (0 = none).
 *  Тонкая обёртка над ЯДРОВЫМ `fleetRadarReach` — не своя копия правила: когда копия
 *  тут читала только `data.units[u].radarRange`, установленный радар-модуль на карте
 *  не считался, хотя игрок за него платил. С масштабом режима и множителем владельца —
 *  тот же радиус, что считает туман. */
export function fleetRadar(f: Fleet): number {
  return fleetRadarReach(game.world(), f, data);
}
/** Слух мира: лучший из его массивов и по УРОВНЮ — правила 5–6 в `sensorScale.ts`. Своему
 *  миру — ровно то, что считает туман (масштаб режима, технологии, блэкаут); чужому —
 *  только масштаб режима: его технологии — не наша разведка. */
export function planetRadar(p: Planet): number {
  const s = game.world();
  return p.owner === game.me()
    ? worldRadarReach(s, p, data)
    : corePlanetRadar(p.buildings, (t) => data.buildings[t]) * sightRulesOf(s).radarScale;
}

/** Draw a coarse amber signature blip (size bucket S/M/L) at a screen point, no
 *  identity. `fade` (0..1) dims it — radar contacts are painted by the sweep and
 *  fade between passes (see drawRadarContacts). */
function drawSignatureAt(
  pos: { x: number; y: number },
  cls: 'S' | 'M' | 'L',
  fade: number,
  now: number,
): void {
  const cx = game.ctx();
  const r = cls === 'L' ? 9 : cls === 'M' ? 7 : 5;
  // Дыхание слоя — `pulseFx.ts` (REFM-137): фаза от места контакта, иначе все метки
  // мигают в такт и читаются как один щёлкающий слой.
  const pulse = fxBreath(now, { period: 200, base: 0.5, amp: 0.5, phase: pos.x * 0.05 });
  cx.save();
  cx.translate(pos.x, pos.y);
  cx.strokeStyle = rgba('#ffb43a', (0.5 + 0.3 * pulse) * fade); // amber = unidentified contact
  cx.fillStyle = rgba('#ffb43a', (0.1 + 0.08 * pulse) * fade);
  cx.lineWidth = 1.3;
  cx.beginPath(); // diamond
  cx.moveTo(0, -r);
  cx.lineTo(r, 0);
  cx.lineTo(0, r);
  cx.lineTo(-r, 0);
  cx.closePath();
  cx.fill();
  cx.stroke();
  cx.fillStyle = rgba('#ffd98a', 0.92 * fade);
  cx.font = '700 9px ui-monospace,Menlo,monospace';
  cx.textAlign = 'center';
  cx.fillText('◆' + cls, 0, r + 12);
  cx.restore();
}

/**
 * Rings for my own radar reach (planet arrays + radar-ships). Each radar projects
 * TWO concentric ranges (matching shared-core visibility): an OUTER signature ring
 * (full reach — enemy fleets show as coarse blips in fog) and an INNER full-reveal
 * ring (half the reach — contacts fully identified). The reach is a Euclidean
 * distance in MAP units; the projection is uniform so they read as true circles.
 * Only meaningful with fog on.
 */
/** One frontier for overlapping sources, painted directly without a screen-sized mask. */
function drawUnionTier(circles: Array<{ x: number; y: number; r: number }>, tier: SightTier): void {
  drawSightFrontier(game.ctx(), circles, tier, LOCK, game.vw(), game.vh(), game.dpr());
}

export function drawRadarCoverage() {
  const cx = game.ctx();
  const ME = game.me();
  // Граница обзора — из ТЕХ ЖЕ кругов, по которым ядро считает туман (`sightCircles`,
  // решение владельца 2026-09-24: «круги везде»): видно ровно то, что внутри неё. Круги
  // свои и союзные (блок зрения); у мира и флота есть базовый круг обзора и без радара.
  // Раньше граница собиралась из радаров одного игрока без множителя технологий, а туман
  // считался иначе — мир светился за нарисованной границей. Круги кладёт кэш кадра
  // (хук `sight` в `main.ts`) — те же, что берёт туман.
  const circles = game.sight();
  if (circles.length === 0) return;
  const selFleetSet = new Set(selectedFleetIds());
  // Project map circles to screen circles (uniform projection ⇒ true circles) — радиус
  // считает `worldDist`, а не проекция смещённой точки: это тот же множитель окольным
  // путём (`mapRadius.ts`, правило 3).
  const screen = (x: number, y: number, rr: number): { x: number; y: number; r: number } => {
    const c = world({ x, y });
    return { x: c.x, y: c.y, r: worldDist(rr) };
  };
  const outer = circles.map((v) => screen(v.x, v.y, v.signature));
  const inner = circles.map((v) => screen(v.x, v.y, v.identify));
  cx.save();
  // The unified visibility frontier: outer (signatures) then inner (full reveal).
  drawUnionTier(outer, 'signature');
  drawUnionTier(inner, 'reveal');
  // A selected planet/fleet additionally shows ITS OWN two rings — crisp + dashed —
  // so you can read one entity's exact reach out of the merged whole.
  for (const v of circles) {
    const selected =
      v.owner === ME &&
      ((v.source.kind === 'world' && v.source.id === selPlanet) ||
        (v.source.kind === 'fleet' && selFleetSet.has(v.source.id)));
    if (!selected) continue;
    const c = world({ x: v.x, y: v.y });
    // Пунктир внешнего и сплошная внутреннего — `sightFrontier.ts` (REFM-120, правило 6).
    const ring = (rr: number, tier: SightTier): void => {
      const r = worldDist(rr);
      if (!ownRingShown(r)) return;
      const look = ownRingLook(tier);
      cx.beginPath();
      cx.arc(c.x, c.y, r, 0, TAU);
      cx.setLineDash([...look.dash]);
      cx.lineWidth = 1.3;
      cx.strokeStyle = rgba(LOCK, look.alpha);
      cx.stroke();
    };
    ring(v.signature, 'signature'); // outer — signatures
    ring(v.identify, 'reveal'); // inner — full reveal
  }
  cx.setLineDash([]);
  cx.restore();
}

/** Draw the radar ranges of the selected sector: the OUTER signature radius (full
 *  reach, animated dashed) and the INNER full-reveal radius (half the reach, solid)
 *  — the two concentric ranges from shared-core visibility. The reach is a physical
 *  distance in map units; the projection is uniform so they read as true circles.
 *  Nothing is drawn for a sector with no radar. (Complements `drawRadarCoverage` —
 *  that shows ALL my sources persistently; this labels the selected one on tap.) */
export function drawRadarRange(now: number): void {
  const s = game.world();
  const cx = game.ctx();
  // Слой крепится к ВЫБРАННОМУ миру — нет выбора, нет и дальномера (REFM-109, правило 5).
  const p = selPlanet ? s.planets[selPlanet] : undefined;
  if (!p) return;
  // Рисовать ли слой и с какими радиусами — `radarSources.ts`, там же причина гейта
  // тумана: `planetRadar` читает ПОСТРОЙКИ мира, и без гейта тап по чужой
  // неисследованной системе был бы мгновенной разведкой одним касанием.
  const rings = rangeRings(
    { detailed: seesDetails(p), reach: planetRadar(p) },
    IDENTIFY_REACH_FRACTION,
  );
  if (rings.do !== 'draw') return;
  const reach = rings.signature;
  const c = world(p.position);
  const pulse = 0.5 + 0.5 * Math.sin(now / 600);
  // Радиус — ОДНО число, а не пара полуосей: проекция равномерна по осям, это обещание
  // камеры (`mapRadius.ts`, правило 2). Эллипс здесь обещал неравномерность, которой нет.
  const radiusPx = (rr: number): number => worldDist(rr);
  cx.save();
  cx.shadowColor = '#5ff0c0';
  cx.textAlign = 'left';
  cx.font = '700 10px ui-monospace,Menlo,monospace';

  // outer — signature reach (coarse blips in fog): «засечка», как в досье радара
  const o = radiusPx(reach);
  cx.fillStyle = rgba('#5ff0c0', 0.012);
  cx.beginPath();
  cx.arc(c.x, c.y, o, 0, TAU);
  cx.fill();
  cx.setLineDash([6, 7]);
  cx.lineDashOffset = -now / 60;
  cx.strokeStyle = rgba('#5ff0c0', 0.3 + 0.12 * pulse);
  cx.lineWidth = 0.8;
  cx.shadowBlur = fxBlur(2);
  cx.stroke();
  cx.fillStyle = rgba('#aef6e6', 0.85);
  cx.fillText(t('map.radar.detect', { n: reach }), c.x + o + 7, c.y + 3);

  // inner — full-reveal reach (contacts fully identified): «опознание»
  const inner = rings.reveal; // та же доля, что у сводного покрытия (REFM-63, правило 4)
  const i = radiusPx(inner);
  cx.fillStyle = rgba('#5ff0c0', 0.02);
  cx.beginPath();
  cx.arc(c.x, c.y, i, 0, TAU);
  cx.fill();
  cx.setLineDash([]);
  cx.strokeStyle = rgba('#7df0d0', 0.5 + 0.12 * pulse);
  cx.lineWidth = 1;
  cx.shadowBlur = fxBlur(3);
  cx.stroke();
  cx.fillStyle = rgba('#aef6e6', 0.9);
  cx.fillText(t('map.radar.identify', { n: Math.round(inner) }), c.x + i + 7, c.y - 7);
  cx.restore();
}
