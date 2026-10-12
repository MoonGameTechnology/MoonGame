/**
 * Флоты карты и их бои (REFM-235, часть 2): значок боя над схваткой с отсчётом до раунда,
 * кольцо орбиты у мира со стоящим флотом, трассы огня между строями боя, сами флоты — корпус
 * доминанта по курсу, засада на развилке, луч бомбардировки, след хода, кольцо плана, рамка
 * выбора и бейдж трюма со счётом — и портреты героев над их флотами.
 *
 * Что показать, решают чистые модели (`battleMark.ts`, `orbitRing.ts`, `unitGlyphs.ts`,
 * `fleetTally.ts`, `decisions/fleetHolds.ts`, `decisions/heroIdentity.ts` и соседи), где
 * стоит флот — `fleetGeometry.ts`; здесь только холст. Мир, своё место, контекст кадра, часы
 * и вид голограммы и тип сектора модуль получает хуками {@link initMapFleets}: они живут в
 * `main.ts`, и импорт оттуда был бы циклом. Слои зовёт кадр `renderMap()`.
 */
import { effectiveStats, type Battle, type Fleet, type GameState } from '../../packages/shared-core/src/index';
import { isOrdnanceFleet } from '../../packages/shared-core/src/state/ordnance';
import { drawAmbushMark } from '../../packages/client/src/forkMark';
import { drawHeroPortrait } from '../../packages/client/src/heroPortraits';
import { rgba } from '../../packages/client/src/holoDraw';
import { drawShipShape } from '../../packages/client/src/shipShapes';
import type { MapLod } from '../../packages/client/src/mapLod';
import { t } from '../../localization/runtime';
import { battleBadgePoint } from '../../decisions/battleTap';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { fleetAloftPlaces, fleetHolds } from '../../decisions/fleetHolds';
import { ambushOf } from '../../decisions/forkAmbush';
import { mapHeroes, type PortraitHit } from '../../decisions/heroIdentity';
import { fleetVeteranGrade } from '../../decisions/veteranMark';
import { battleMark } from './battleMark';
import { chainStepsOf } from './chainComposer';
import { battleAnchor, fleetAnchor, orbitRingRadius } from './fleetGeometry';
import { drawFleetHoldBadge } from './fleetHoldView';
import { emblemTally } from './fleetTally';
import { data, type SECTOR_TYPES } from './game';
import { fxBlur, fxBreath, glowOn, motionOn } from './graphicsPrefs';
import { drawHolographicBattle } from './holographicEffects';
import { selFleet, selFleets } from './interaction';
import { visible, world } from './mapCamera';
import { battleKnown, fleetSeen } from './mapFog';
import { drawBattlePulse, targetBrackets } from './mapOverlays';
import { ORBIT_COLOR, TAU, ownerColor } from './mapPalette';
import { ringShown } from './orbitRing';
import { isWingUnit } from './planetSummary';
import { phaseOfId } from './pulseFx';
import { chevronAlpha } from './semanticZoom';
import { dominantUnit, glyphHalo, glyphScale, unitArchetype, unitShape, unitSizeClass } from './unitGlyphs';
import { timeLeft } from './worldQueries';

/** Что флотам карты нужно от игры. */
export interface MapFleetsHost {
  /** Мир, который показывает кадр. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Контекст канваса карты. */
  ctx(): CanvasRenderingContext2D;
  /** Часы голограммы: стоят на паузе и при отключённой анимации. */
  clock(): number;
  /** Голографический вид карты. */
  holographic(): boolean;
  /** Тип сектора узла; `undefined` — узел не на карте. */
  sectorType(id: string): (typeof SECTOR_TYPES)[string] | undefined;
}

let game: MapFleetsHost;

/** Подключить флоты карты к игре. */
export function initMapFleets(host: MapFleetsHost): void {
  game = host;
}

const holographicMapOn = (): boolean => game.holographic();
const sectorTypeOf = (id: string): (typeof SECTOR_TYPES)[string] | undefined => game.sectorType(id);
// Крыло — сами машины, носитель — корабль линии (`planetSummary.ts`, ROS-3.2): в счёт корпусов
// флота крыло на борту не входит.
const isShuttle = (u: string) => isWingUnit(u, data);
// Экранные хитбоксы портретов героев: кадр их пересобирает, а портрет, который лёг бы на
// уже нарисованный, сдвигается (`heroPortraits.ts`).
let heroPortraitHits: PortraitHit[] = [];

/** Последняя секунда перед раундом: кольцо значка стягивается к центру (эффект
 *  `drawHolographicBattle`). Считается ИЗ состояния, без своей памяти о кадрах, —
 *  поэтому вспышка не может разъехаться с тем же отсчётом в подписи и в окне боя. */
const ROUND_FLASH_MS = 1200;
function roundFlash(b: Battle): number {
  const s = game.world();
  if (typeof b.nextRoundAt !== 'number') return 0;
  const left = b.nextRoundAt - s.time;
  return left > 0 && left < ROUND_FLASH_MS ? 1 - left / ROUND_FLASH_MS : 0;
}

/**
 * Бои — пульсирующее красное кольцо в точке схватки (у флота в бою, поэтому перехват
 * посреди дороги виден там, где он идёт) с живым отсчётом до часового раунда урона.
 */
export function drawBattles(now: number, detail: number): void {
  const s = game.world();
  const cx = game.ctx();
  const hologramTime = game.clock();
  const wave = (now / 900) % 1;
  for (const b of Object.values(s.battles)) {
    const anchor = battleAnchor(b);
    // Показывать ли бой и его таймер — `battleMark.ts` (REFM-118): под туманом отметки
    // нет вовсе, а отсчёт живёт только по назначенному ядром раунду.
    const roundAt = typeof b.nextRoundAt === 'number' ? b.nextRoundAt : undefined;
    const mark = battleMark({
      identified: battleKnown(b),
      hasPoint: !!anchor,
      detail,
      nextRoundAt: roundAt,
    });
    if (mark.do !== 'draw' || !anchor) continue;
    // Значок висит НАД точкой схватки (`battleBadgePoint`) — одна точка на рисование и
    // на тап: кольцо поверх самих кораблей воровало бы у них тап, а разъехавшись с
    // целью тапа, оно отправляло бы палец мимо того, что видно.
    const c = battleBadgePoint(world(anchor));
    if (!visible(c, 120)) continue;
    if (holographicMapOn())
      drawHolographicBattle(
        cx,
        c.x,
        c.y,
        hologramTime,
        b.phase ?? 'orbital',
        glowOn(),
        detail,
        roundFlash(b),
      );
    else drawBattlePulse(c.x, c.y, wave, b.phase);
    if (mark.timer) {
      // `mark.timer` истинно только при назначенном раунде — отсюда и `!` ниже.
      cx.save();
      cx.globalAlpha = detail; // LOD: the timer text dissolves on the schematic view
      cx.font = '700 10px ui-monospace,Menlo,monospace';
      cx.textAlign = 'center';
      cx.fillStyle = b.phase === 'ground' ? '#f5cf6b' : '#ff8a7d';
      cx.fillText(
        `${b.phase === 'ground' ? t('map.badge.landing') : t('map.badge.orbit')} · ${timeLeft(roundAt!)}`,
        c.x,
        c.y - (holographicMapOn() ? 51 : 28),
      );
      cx.restore();
    }
  }
}

/** Кольцо орбиты у мира, где стоит флот (одна орбита). У развязки поля астероидов орбиты нет. */
export function drawOrbitRings(now: number, detail: number): void {
  const s = game.world();
  const cx = game.ctx();
  const stationed: Record<string, Fleet[]> = {};
  for (const f of Object.values(s.fleets))
    if (f.location && !f.movement) {
      if (!fleetSeen(f)) continue; // hidden enemy orbit (no identify, no intel window)
      (stationed[f.location] ??= []).push(f);
    }
  for (const pid of Object.keys(stationed)) {
    const pl = s.planets[pid];
    if (!pl) continue;
    // У кого кольцо ЕСТЬ — `orbitRing.ts` (REFM-114), там же и его геометрия: город имеет
    // орбиту по типу, а узел-развязка получает её только УКРЕПЛЁННЫМ (крепость или живой
    // гарнизон) — такой узел приходится штурмовать, а штурм идёт с орбиты.
    const shown = ringShown(
      {
        typeHasOrbit: !!sectorTypeOf(pid)?.orbit,
        starfort: pl.buildings.some((b) => b.type === 'starfort'),
        garrison: pl.garrison ?? [],
        parked: stationed[pid]?.length ?? 0,
      },
      detail,
    );
    if (!shown) continue;
    const pc = world(pl.position);
    if (!visible(pc, 80)) continue;
    // A single orbit ring (GDD §7.4) — one orbit, so no N/F labels cluttering the map.
    const rr = orbitRingRadius(pl);
    cx.save();
    cx.globalAlpha = detail;
    cx.setLineDash([2, 5]);
    cx.lineDashOffset = now / 200;
    cx.strokeStyle = rgba(ORBIT_COLOR, 0.4);
    cx.lineWidth = 1.3;
    cx.beginPath();
    cx.arc(pc.x, pc.y, rr, 0, TAU);
    cx.stroke();
    cx.restore();
  }
}

/** Трассы огня между строями боя (заказ владельца 2026-09-23): от каждого флота к ближайшему
 *  флоту другой стороны — пунктир цвета стрелка, бегущий к цели, пока бой идёт. При
 *  выключенном движении пунктир стоит. Только видимые флоты: трасса к невидимому выдала бы
 *  его место. */
export function drawBattleTracers(now: number): void {
  const s = game.world();
  const cx = game.ctx();
  for (const b of Object.values(s.battles)) {
    const sides = Object.values(s.fleets)
      .filter((f) => f.battleId === b.id && !f.movement && fleetSeen(f))
      .map((f) => ({ f, a: fleetAnchor(f) }))
      .filter((x): x is { f: Fleet; a: { x: number; y: number; ang: number } } => !!x.a);
    for (const { f, a } of sides) {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const o of sides) {
        if (o.f.owner === f.owner) continue;
        const d = Math.hypot(o.a.x - a.x, o.a.y - a.y);
        if (d < bestD) {
          bestD = d;
          best = o.a;
        }
      }
      if (!best || !visible(a, 120)) continue;
      const col = ownerColor(f.owner);
      cx.save();
      cx.strokeStyle = rgba(col, 0.55);
      cx.lineWidth = 1.4;
      cx.setLineDash([6, 9]);
      cx.lineDashOffset = motionOn() ? -now / 40 : 0;
      cx.shadowColor = col;
      cx.shadowBlur = fxBlur(8);
      cx.beginPath();
      cx.moveTo(a.x, a.y);
      cx.lineTo(best.x, best.y);
      cx.stroke();
      cx.restore();
    }
  }
}

/** Флоты: светящиеся корпуса на кольце орбиты (стоящие) или вдоль дороги, и портреты героев. */
export function drawFleets(now: number, lod: MapLod): void {
  const s = game.world();
  const cx = game.ctx();
  const ME = game.me();
  const detail = lod.detail;
  // Portraits are resolved only from our own roster, even in full-state solo games.
  const heroesByFleet = mapHeroes(s, ME);
  heroPortraitHits = [];
  // fleets — glowing chevrons on their orbit ring (stationed) or along the lane
  cx.textAlign = 'center';
  for (const f of Object.values(s.fleets)) {
    // Мину рисует `drawMinefields` своим знаком (SM-3.6), ракету — `drawMissiles` (SM-3.7b).
    if (isOrdnanceFleet(f, data)) continue;
    if (!fleetSeen(f)) {
      // not identified and no intel window: a radar contact is shown only as a
      // swept signature (drawRadarContacts), painted by the arm — never live here.
      continue;
    }
    const A = fleetAnchor(f);
    if (!A || !visible(A, 120)) continue;
    const col = ownerColor(f.owner);
    // ROADS-4: флот на развилке — засада (`ambushOf` спрашивает у ядра, стоит ли он РОВНО на
    // ней): пунктирный ромб цвета владельца под корпусом.
    if (ambushOf(s, f)) drawAmbushMark(cx, A.x, A.y, rgba(col, 0.85));
    // Aircraft aboard never inflate the combat hull count.
    const { ships } = emblemTally(f.units, [], isShuttle);
    // Фаза от ХЭША идентификатора, а не от его длины (`pulseFx.ts`, правило 2): у
    // «p1-1» и «p2-3» длина одна, и все флоты матча заводили двигатели в такт.
    const engine = fxBreath(now, { period: 120, base: 0.55, amp: 0.45, phase: phaseOfId(f.id) });

    // bombardment beam down to the planet
    if (f.bombarding && f.location) {
      const target = s.planets[f.location];
      if (target) {
        const pc = world(target.position);
        const spark = fxBreath(now, { period: 90, base: 0.45, amp: 0.55, phase: phaseOfId(f.id) });
        cx.save();
        cx.strokeStyle = rgba('#ffb15f', 0.3 + 0.3 * spark);
        cx.lineWidth = 1.2 + spark;
        cx.shadowColor = '#ffb15f';
        cx.shadowBlur = fxBlur(12);
        cx.beginPath();
        cx.moveTo(A.x, A.y);
        cx.lineTo(pc.x, pc.y);
        cx.stroke();
        cx.restore();
      }
    }

    // contact trail while moving
    if (f.movement) {
      for (let i = 1; i <= 4; i++) {
        cx.fillStyle = rgba(col, 0.33 - 0.055 * i);
        cx.beginPath();
        cx.arc(
          A.x - Math.cos(A.ang) * i * (8 + engine * 2),
          A.y - Math.sin(A.ang) * i * (8 + engine * 2),
          2.8 - 0.35 * i,
          0,
          TAU,
        );
        cx.fill();
      }
    }

    const dom = dominantUnit(f.units, data);
    const shape = (dom && unitShape(dom.def, dom.unit, s.players[f.owner]?.faction)) || 'cruiser';
    const arch = dom ? unitArchetype(dom.def) : 'combat';
    const domK = glyphScale(dom ? unitSizeClass(dom.def.stats.hp ?? 0) : 'S');
    // На удалении остаётся внешний контур ТОГО ЖЕ корпуса. Внутренняя детализация,
    // карго и счёт плавно исчезают, но фрегат не превращается в общий треугольник.
    if (detail < 1) {
      cx.save();
      cx.globalAlpha = chevronAlpha(detail);
      cx.translate(A.x, A.y);
      cx.rotate(A.ang + Math.PI / 2);
      cx.shadowColor = col;
      cx.shadowBlur = fxBlur(5 + 4 * engine);
      cx.scale(domK * 0.8, domK * 0.8);
      cx.translate(-12, -12);
      cx.fillStyle = rgba(col, 0.28);
      cx.strokeStyle = rgba(col, 0.95);
      drawShipShape(cx, shape, false);
      cx.restore();
    }
    // Крепость — одно сооружение: счёт «×N» у неё читался бы как N крепостей.
    const emplacement = isEmplacementFleet(f, data);
    if (detail === 0) {
      if (!emplacement) drawFleetHoldBadge(cx, A, null, ships, [], false, col, fleetVeteranGrade(f.units, data));
      // selection still reads on the schematic view; the rest of the kit is gone
      if (selFleet === f.id || selFleets.has(f.id)) targetBrackets(A.x, A.y, 12, now);
      continue;
    }
    cx.globalAlpha = detail; // full detail fades back in toward 1.45

    // Fleet emblem (постер «Типы кораблей»): ОДИН силуэт ДОМИНАНТА — сильнейшего
    // корабля флота — вместо пирамиды треугольников; количество несёт счётчик
    // «×N» в горизонтальном бейдже («флот на карте = доминант + счёт», полный состав — в
    // панели выделения). Размер S/M/L по hp доминанта, гало-кольцо при щите
    // (у флагмана — всегда), нос по курсу — heading от fleetAnchor, как раньше;
    // шкалы вместимости и счётчик остаются горизонтальными.
    // Размер — из ЕДИНОЙ таблицы постера (`unitGlyphs.ts`, правило 1). Здесь стояла
    // своя (S 0.62 · M 0.8), и один и тот же разведчик был в панели заметно крупнее,
    // чем на карте: «размер = hp» переставал быть шкалой ровно там, где ею пользуются.
    const domStack = dom ? f.units.find((st) => st.unit === dom.unit && st.count > 0) : undefined;
    const domShield =
      dom && domStack ? (effectiveStats(dom.def, domStack, data).shield ?? 0) > 0 : false;
    cx.save();
    cx.translate(A.x, A.y);
    cx.rotate(A.ang + Math.PI / 2);
    cx.shadowColor = col;
    cx.shadowBlur = fxBlur(6 + 6 * engine);
    if (glyphHalo(arch, domShield)) {
      // Модификатор «есть щит» (у флагмана — всегда): пунктирная орбита вокруг силуэта.
      // Само правило — в `unitGlyphs.ts` (правило 2); РАДИУС здесь свой и намеренно:
      // на карте бокса нет, кольцо обязано ехать за силуэтом (правило 3).
      cx.strokeStyle = rgba(col, 0.7);
      cx.lineWidth = 1.1;
      cx.setLineDash([2.6, 2.8]);
      cx.beginPath();
      cx.arc(0, 0, 12.5 * domK + 2, 0, TAU);
      cx.stroke();
      cx.setLineDash([]);
    }
    cx.scale(domK, domK);
    cx.translate(-12, -12);
    cx.fillStyle = rgba(col, 0.24);
    cx.strokeStyle = rgba(col, 0.95);
    drawShipShape(cx, shape, true);
    cx.restore();

    if (f.owner === ME && chainStepsOf(f.id)) {
      // TGT-1: an army carrying a standing plan breathes a dashed accent ring —
      // one glance tells which fleets are already "spoken for".
      const pu = fxBreath(now, { period: 300, base: 0.5, amp: 0.5, phase: phaseOfId(f.id) });
      cx.save();
      cx.strokeStyle = rgba(ownerColor(ME), 0.3 + 0.4 * pu);
      cx.lineWidth = 1.3;
      cx.setLineDash([4, 4]);
      cx.beginPath();
      cx.arc(A.x, A.y, 12.5, 0, TAU);
      cx.stroke();
      cx.restore();
    }
    // Радиус артиллерии и линию огня рисует слой RANGE-UX (`drawCombatRanges` поверх
    // `combatRanges.ts`) — ровно для тех же выбранных флотов. Здесь стояла ВТОРАЯ копия
    // того же кольца, другим цветом и пунктиром: два кольца одного радиуса каждый кадр
    // (REFM-123). Осталась только рамка выбора.
    if (selFleet === f.id || selFleets.has(f.id)) targetBrackets(A.x, A.y, 15, now);

    cx.globalAlpha = 1; // Counts remain readable throughout the LOD cross-fade.
    // Own hold occupancy is read from the snapshot; foreign manifests stay private.
    // The badge remains horizontal and outside the orbit even as heading changes.
    const dock = !f.movement && f.location ? s.planets[f.location] : null;
    if (!emplacement) drawFleetHoldBadge(
      cx, A, heroesByFleet.has(f.id) ? null : dock ? world(dock.position) : null, ships,
      f.owner === ME ? fleetHolds(f, data, s.time, fleetAloftPlaces(s, f, data)) : [],
      selFleet === f.id || selFleets.has(f.id) || lod.scale >= 1.9,
      col,
      fleetVeteranGrade(f.units, data),
    );

    cx.globalAlpha = 1; // end of the per-fleet LOD cross-fade
  }

  // Draw portraits after hulls, in screen pixels; they never rotate with the ships.
  for (const [fleetId, hero] of heroesByFleet) {
    const selected = selFleet === fleetId || selFleets.has(fleetId);
    if (detail < 0.45 && !selected) continue;
    const f = s.fleets[fleetId]!;
    const anchor = fleetAnchor(f);
    if (!anchor || !visible(anchor, 120)) continue;
    const hit = drawHeroPortrait(cx, hero, anchor, ownerColor(f.owner), heroPortraitHits);
    if (hit) heroPortraitHits.push(hit);
  }
}
