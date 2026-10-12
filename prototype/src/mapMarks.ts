/**
 * Метки карты (REFM-234): то, что стоит на карте, пока верно в мире, — цели задач забега с
 * флажком, цель операции союзника и знак носителя, летящие ракеты, минные поля и установки,
 * осада «Поглощения мира» с отсчётом, булавки меток коалиции и линии отправленных цепочек
 * «Приказ» с черновиком открытого режима.
 *
 * Что метить, решают чистые модели (`missionRing.ts`, `allyPanel.ts`, `devourSiege.ts`,
 * `pingPulse.ts`, `chainBadges.ts`, `chainPathLayout.ts` и соседи), режим «Приказ» и его
 * маршруты — `chainComposer.ts`; здесь только холст. Своё у модуля — экранные хитбоксы
 * булавок и ◎-бейджей планов: кадр их пересобирает, тап по карте (`mapInput.ts`) по ним
 * ищет цель. Мир, своё место, контекст кадра, часы голограммы, вид карты, метки коалиции и
 * задачи с цепочкой главы модуль получает хуками {@link initMapMarks}: они живут в
 * `main.ts`, и импорт оттуда был бы циклом. Рисовалки зовёт кадр `renderMap()`.
 */
import type { Fleet, GameState } from '../../packages/shared-core/src/index';
import { isMineFleet } from '../../packages/shared-core/src/state/minefields';
import { isMissileFleet, isRocketMineFleet } from '../../packages/shared-core/src/state/ordnance';
import { rgba } from '../../packages/client/src/holoDraw';
import { drawMineShape } from '../../packages/client/src/mineShape';
import { drawMissile } from '../../packages/client/src/ordnanceView';
import { t } from '../../localization/runtime';
import { allyPanelView } from '../../decisions/allyPanel';
import type { ChapterStep } from '../../decisions/chapterChain';
import { devourSieges } from '../../decisions/devourSiege';
import { mineCard } from '../../decisions/mineCard';
import { ownInstallations } from '../../decisions/minefields';
import { missionRingFrame, missionRingPhase, RING_R, RING_W } from '../../decisions/missionRing';
import type { MissionRow } from '../../decisions/missionView';
import { ALLY_EMBLEM } from './allyScreen';
import { BADGE_DY, badgeCount, badgePulse, groupByAnchor, shownOrders, type AnchoredOrder } from './chainBadges';
import { chainAbilityHoldH, chainMenuAnchor, chainMode, chainRoute, chainStart, chainTravelH } from './chainComposer';
import { capsuleAt, chainPathNodes, lastStepAtPoint, stackIndexes } from './chainPathLayout';
import { chainTimeline, draftFinish, stepGlyph, stepHours } from './chainPlanner';
import type { SessionMsg } from './conversations';
import { fleetAnchor, fleetOriginPx, fleetPos } from './fleetGeometry';
import { countdownHMS, fmtEta } from './format';
import { HOUR, data, type ChainStep } from './game';
import { fxBlur, glowOn, motionOn } from './graphicsPrefs';
import { drawHolographicPing } from './holographicEffects';
import { cam, visible, world } from './mapCamera';
import { fleetSeen } from './mapFog';
import { HOSTILE, LOCK, TAU, ownerColor } from './mapPalette';
import { RING_OFFSETS, dropInAlpha, pinPulse, pingPhase, ringAlpha, ringProgress, ringRadius, ringWidth } from './pingPulse';
import { sectorRunActive } from './sectorRun';
import { COLOR } from './sideColors';

/** Что меткам нужно от игры. */
export interface MapMarksHost {
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
  /** Показывать ли свои метки (переключатель «Свои метки»). */
  ownPings(): boolean;
  /** Метки коалиции, которые можно рисовать. */
  pings(): readonly SessionMsg[];
  /** Задачи этого забега. */
  missionRows(): MissionRow[];
  /** Главная цепочка главы; в этой главе её нет — `null`. */
  chain(): ChapterStep[] | null;
}

let game: MapMarksHost;

/** Подключить метки к игре. */
export function initMapMarks(host: MapMarksHost): void {
  game = host;
}

// Хитбоксы ◎-бейджей отправленных планов (тап вне режима = редактирование плана).
export let chainHits: Array<{ target: string; fleetIds: string[]; x: number; y: number }> = [];
// Screen hit-boxes for the on-map ping markers, rebuilt every frame by drawPings().
export let pingHits: Array<{ loc: string; x: number; y: number }> = [];

/** Метки целей задач на карте: дышащее мятное кольцо и флажок над миром. Выполненная
 *  задача меток не держит (`missionView.ts`, правило 3). Текущий шаг главной цепочки главы
 *  (точка встречи, архив, зона вывода) метится так же — это тоже цель. */
export function drawMissionTargets(): void {
  const s = game.world();
  const cx = game.ctx();
  if (!sectorRunActive) return;
  const chainAt = game.chain()?.find((st) => st.active)?.target;
  const ids = new Set([...game.missionRows().flatMap(r => r.targets), ...(chainAt ? [chainAt] : [])]);
  if (ids.size === 0) return;
  cx.save();
  for (const id of ids) {
    const p = s.planets[id];
    if (!p) continue;
    const c = world(p.position);
    if (!visible(c, 60)) continue;
    // `game.clock()` — визуальные часы карты: стоят на паузе и при отключённой анимации.
    // Ритм кольца (пунктир уходит волнами, как сонар метки, бежит и дышит) и своя фаза
    // цели — `decisions/missionRing.ts`.
    const { breath, dashOffset, waves } = missionRingFrame(game.clock(), motionOn(), missionRingPhase(p.position));
    cx.shadowColor = '#8ff5c8';
    cx.shadowBlur = fxBlur(4);
    for (const w of waves) {
      cx.strokeStyle = `rgba(143,245,200,${w.alpha})`;
      cx.lineWidth = w.width;
      cx.setLineDash([6 * w.scale, 5 * w.scale]);
      cx.lineDashOffset = dashOffset * w.scale;
      cx.beginPath();
      cx.arc(c.x, c.y, w.r, 0, TAU);
      cx.stroke();
    }
    cx.strokeStyle = `rgba(143,245,200,${0.55 + 0.35 * breath})`;
    cx.lineWidth = RING_W;
    cx.setLineDash([6, 5]);
    cx.lineDashOffset = dashOffset;
    cx.shadowBlur = fxBlur(6 + 6 * breath);
    cx.beginPath();
    cx.arc(c.x, c.y, RING_R, 0, TAU);
    cx.stroke();
    cx.setLineDash([]);
    cx.lineDashOffset = 0;
    // флажок над миром: древко и полотнище
    const x = c.x + 17;
    const y = c.y - 34;
    cx.strokeStyle = 'rgba(4,10,12,.9)';
    cx.fillStyle = '#8ff5c8';
    cx.lineWidth = 1.4;
    cx.beginPath();
    cx.moveTo(x, y + 20);
    cx.lineTo(x, y);
    cx.lineTo(x + 15, y + 5);
    cx.lineTo(x, y + 10);
    cx.closePath();
    cx.fill();
    cx.stroke();
  }
  cx.restore();
}

/** Глава IV (PVR-7.5): синяя метка цели операции союзника с его эмблемой (§6.5) и знак
 *  накопителя над флотом-носителем (§6.7). Принадлежность различается не только цветом:
 *  у союзной метки эмблема, у носителя — свой знак. */
export function drawAllyMarks(): void {
  const s = game.world();
  const cx = game.ctx();
  const ME = game.me();
  if (!sectorRunActive) return;
  cx.save();
  const view = allyPanelView(s, ME, data);
  const op = view?.op;
  const at = op
    ? (op.planet ?? (op.fleet ? (s.fleets[op.fleet]?.location ?? undefined) : undefined))
    : undefined;
  const target = at ? s.planets[at] : undefined;
  if (target) {
    const c = world(target.position);
    if (visible(c, 60)) {
      const own = op!.source === 'own';
      cx.strokeStyle = own ? 'rgba(74,140,255,.45)' : COLOR.ally!;
      cx.lineWidth = 2;
      cx.setLineDash([4, 4]);
      cx.beginPath();
      cx.arc(c.x, c.y, RING_R + 6, 0, TAU);
      cx.stroke();
      cx.setLineDash([]);
      cx.fillStyle = COLOR.ally!;
      cx.font = '700 13px ui-monospace,monospace';
      cx.textAlign = 'center';
      cx.fillText(ALLY_EMBLEM, c.x - RING_R - 4, c.y - RING_R - 2);
    }
  }
  // Носитель — накопителя главы IV или пленного главы V (PVR-9.5): тот же янтарный ◈.
  const carriers = [
    s.extraction?.deliveredAt === undefined ? s.extraction?.carrier : undefined,
    s.captive?.deliveredAt === undefined && s.captive?.lostAt === undefined ? s.captive?.carrier : undefined,
  ];
  for (const id of carriers) {
    const carrier = id ? s.fleets[id] : undefined;
    // `fleetAnchor` — уже точка экрана (значок на кольце орбиты): второй перевод `world()`
    // уводил знак от носителя тем дальше, чем крупнее карта.
    const c = carrier ? fleetAnchor(carrier) : null;
    if (!c || !visible(c, 40)) continue;
    cx.fillStyle = '#ffb43a';
    cx.strokeStyle = 'rgba(4,10,12,.9)';
    cx.lineWidth = 3;
    cx.font = '700 15px ui-monospace,monospace';
    cx.textAlign = 'center';
    cx.strokeText('◈', c.x, c.y - 20);
    cx.fillText('◈', c.x, c.y - 20);
  }
  cx.restore();
}

/** Летящие ракеты (SM-3.7b) — отряды, но не корабли: стрелка по курсу и пунктир к точке
 *  цели в цвете владельца (`drawMissile`), без корпуса и счётчика. Видна по обычному туману
 *  (`fleetSeen`); чужую подписывает «Входящая ракета», когда карта крупна для подписи. */
export function drawMissiles(): void {
  const s = game.world();
  const cx = game.ctx();
  const ME = game.me();
  for (const f of Object.values(s.fleets)) {
    if (!f.flight || !isMissileFleet(f, data) || !fleetSeen(f)) continue;
    const at = fleetPos(f);
    if (!at) continue;
    const c = world(at);
    if (!visible(c, 120)) continue;
    const label = f.owner !== ME && cam.scale >= 0.8 ? t('mine.incoming') : undefined;
    drawMissile(cx, c, world(f.flight.to), ownerColor(f.owner), label);
  }
}

/** Знаки мин (SM-3.6) и своих установок (SM-3.5) на карте; вспышку срабатывания рисует
 *  `mapEffects.ts`. */
export function drawMinefields(): void {
  const s = game.world();
  const cx = game.ctx();
  const ME = game.me();
  // Установки — свои, по месту носителя; мины (SM-3.6) — отряды во `fleets`, чужие только
  // вблизи (`fleetSeen`). Мина стоит там же, куда смотрит палец (`fleetAnchor`: на дороге —
  // в своей точке, на узле — на кольце орбиты), иначе тап по знаку промахивался бы мимо неё.
  // Знак один: сфера мины, у установки — пунктиром и «◷».
  const marks: Array<{ c: { x: number; y: number }; owner: string; label: string; installing: boolean }> = [];
  // Носитель — по ключу среза (`ownInstallations`): сравнение по ссылке не находило его,
  // и дорожная установка теряла знак (ревью #1411).
  for (const { layer, job } of ownInstallations(s, ME)) {
    const at = layer ? fleetPos(layer) : job.location ? s.planets[job.location]?.position : null;
    if (!at) continue;
    const c = world(at);
    marks.push({ c: job.location === null ? c : { x: c.x, y: c.y - 44 }, owner: job.owner, label: '◷', installing: true });
  }
  for (const f of Object.values(s.fleets)) {
    if (!isMineFleet(f, data) || !fleetSeen(f)) continue;
    const c = fleetAnchor(f);
    // Ракетная мина — один заряд, счётчик ей ни к чему (SM-3.7a).
    const label = isRocketMineFleet(f, data) ? '' : `×${mineCard(f, data).charges}`;
    if (c) marks.push({ c, owner: f.owner, label, installing: false });
  }
  for (const m of marks) {
    if (!visible(m.c, 40)) continue;
    cx.save(); cx.translate(m.c.x - 12, m.c.y - 12);
    cx.strokeStyle = m.owner === ME ? '#60dbe8' : '#ffac62';
    cx.fillStyle = 'rgba(4,10,12,.85)'; cx.lineWidth = 1.2;
    cx.setLineDash(m.installing ? [2, 2] : []);
    drawMineShape(cx, cam.scale >= 0.9);
    cx.setLineDash([]);
    cx.fillStyle = cx.strokeStyle; cx.font = '11px ui-monospace, monospace';
    cx.textAlign = 'left'; cx.fillText(m.label, 26, 15);
    cx.restore();
  }
}

/** Осада «Поглощения мира» над своим миром (PVR-4.7): красное кольцо-часы — дуга тает к
 *  гибели мира — и отсчёт над ним в тех же часах, что у волн (`decisions/devourSiege.ts`).
 *  Текста нет: знак и время, поэтому и локали не нужно. */
export function drawDevourSieges(): void {
  const s = game.world();
  const cx = game.ctx();
  const ME = game.me();
  const marks = devourSieges(s, ME);
  if (marks.length === 0) return;
  const R = 31;
  cx.save();
  cx.textAlign = 'center';
  cx.textBaseline = 'top';
  cx.font = '700 12px ui-monospace, monospace';
  for (const m of marks) {
    const p = s.planets[m.target];
    if (!p) continue;
    const c = world(p.position);
    if (!visible(c, 60)) continue;
    cx.lineWidth = 4;
    cx.strokeStyle = 'rgba(255,90,77,.22)';
    cx.beginPath();
    cx.arc(c.x, c.y, R, 0, TAU);
    cx.stroke();
    cx.strokeStyle = HOSTILE;
    cx.shadowColor = HOSTILE;
    cx.shadowBlur = fxBlur(8);
    cx.beginPath();
    cx.arc(c.x, c.y, R, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - m.progress));
    cx.stroke();
    cx.shadowBlur = 0;
    // Отсчёт — на тёмной плашке: у дома тесно (плашки флотов, портрет героя), и голый
    // текст тонул бы в них. Плашку не заслоняет ничего — слой рисуется поверх флотов.
    const label = `☠ ${countdownHMS(m.leftMs)}`;
    const w = Math.ceil(cx.measureText(label).width) + 12;
    const top = Math.round(c.y + R + 5);
    const left = Math.round(c.x - w / 2);
    cx.fillStyle = 'rgba(4,10,12,.9)';
    cx.fillRect(left, top, w, 17);
    cx.lineWidth = 1;
    cx.strokeStyle = HOSTILE;
    cx.strokeRect(left + 0.5, top + 0.5, w - 1, 16);
    cx.fillStyle = HOSTILE;
    cx.fillText(label, c.x, top + 3);
  }
  cx.restore();
}

/** Draw a pin per active coalition ping (owner-coloured), recording screen hit-boxes
 *  for tap detection. Pins float just above the node, tip pointing at it. Two sonar
 *  rings expand from the marked node (half a period apart) and the pin head breathes
 *  an owner-coloured glow — a "look here" you can catch from across the map. Your
 *  own pins can be hidden with the settings switch (allies' are always drawn). */
export function drawPings(now: number): void {
  const s = game.world();
  const cx = game.ctx();
  const ME = game.me();
  pingHits = [];
  for (const m of game.pings()) {
    // `drawable()` уже отбросил спрятанные ЛОКАЛЬНО (у союзника метка цела).
    if (m.from === ME && !game.ownPings()) continue; // hidden by «Свои метки» switch
    const pl = s.planets[m.ping!];
    if (!pl) continue;
    const c = world(pl.position);
    if (!visible(c, 40)) continue;
    const x = c.x;
    const y = c.y - 22; // pin head floats above the node (плейтест: пинги крупнее)
    const col = ownerColor(m.from);
    if (game.holographic()) {
      drawHolographicPing(cx, c.x, c.y, col, game.clock(), pingPhase(x), glowOn());
      pingHits.push({ loc: m.ping!, x, y: y - 1 });
      continue;
    }
    // Фазы, дыхание и жизнь колец — `pingPulse.ts` (REFM-72).
    const phase = pingPhase(x);
    const pulse = pinPulse(now, phase);
    cx.save();
    // sonar waves: rings born at the node, growing and thinning out as they fade;
    // a newborn ring flashes a soft filled core so each wave visibly "drops in"
    cx.shadowColor = rgba(col, 0.7);
    for (const off of RING_OFFSETS) {
      const k = ringProgress(now, phase, off);
      const rr = ringRadius(k);
      const drop = dropInAlpha(k);
      if (drop > 0) {
        cx.fillStyle = rgba(col, drop); // the drop-in flash
        cx.beginPath();
        cx.arc(c.x, c.y, rr, 0, TAU);
        cx.fill();
      }
      cx.shadowBlur = fxBlur(6 * (1 - k));
      cx.strokeStyle = rgba(col, ringAlpha(k));
      cx.lineWidth = ringWidth(k);
      cx.beginPath();
      cx.arc(c.x, c.y, rr, 0, TAU);
      cx.stroke();
    }
    // the pin itself, breathing an owner-coloured glow (the dark stroke keeps contrast)
    cx.shadowColor = rgba(col, 0.85);
    cx.shadowBlur = fxBlur(4 + 8 * pulse);
    cx.fillStyle = rgba(col, pulse);
    cx.strokeStyle = 'rgba(4,10,12,.85)';
    cx.lineWidth = 1.4;
    cx.beginPath(); // teardrop pin: head + tip toward the node
    cx.moveTo(x, y + 14);
    cx.lineTo(x - 6.5, y);
    cx.arc(x, y - 1, 7, Math.PI, 0);
    cx.lineTo(x, y + 14);
    cx.fill();
    cx.stroke();
    cx.shadowBlur = 0;
    cx.fillStyle = 'rgba(6,18,22,.95)';
    cx.beginPath();
    cx.arc(x, y - 1, 2.7, 0, TAU);
    cx.fill();
    cx.fillStyle = rgba(col, pulse); // a blinking ember in the pin's eye
    cx.beginPath();
    cx.arc(x, y - 1, 1.4, 0, TAU);
    cx.fill();
    cx.restore();
    pingHits.push({ loc: m.ping!, x, y: y - 1 });
  }
}

/** TGT-1: standing order markers — a breathing crosshair on every world an OWN
 *  chained fleet is planned against (last move leg; a legless plan anchors at the
 *  fleet's spot). The ◎ badge above the ring is the tap handle (screen hit-boxes,
 *  like pings) — tapping it re-opens the composer with the live plan. */
/** CHAIN-UX: полилиния + капсулы шагов + накопленное «~T» для ОДНОЙ цепочки.
 *  Времена — клиентская оценка (авторитетны только arrivesAt/waitUntil головы),
 *  поэтому всегда с «~». Рисуется без LOD-затухания: план — то, ради чего смотрят. */
function drawChainPath(
  f: Fleet,
  steps: ChainStep[],
  fromId: string | null,
  baseH: number,
  headRemH: number | undefined,
  alpha: number,
): void {
  const s = game.world();
  const cx = game.ctx();
  if (!steps.length || !fromId) return;
  const start = fleetOriginPx(f);
  if (!start) return;
  const tl = chainTimeline(steps, fromId, baseH, chainTravelH(f), chainAbilityHoldH([f.id]), headRemH);
  // Полилиния: от якоря флота по маршруту каждого перелёта (стиль drawFleetRoutes).
  const pts: Array<{ x: number; y: number }> = [start];
  for (const hop of chainPathNodes(steps, fromId, chainRoute)) {
    const pl = s.planets[hop];
    if (pl) pts.push(world(pl.position));
  }
  cx.save();
  cx.globalAlpha = alpha;
  if (pts.length > 1) {
    cx.setLineDash([4, 6]);
    cx.strokeStyle = rgba(LOCK, 0.75);
    cx.lineWidth = 1.4;
    cx.shadowColor = LOCK;
    cx.shadowBlur = fxBlur(3);
    cx.beginPath();
    cx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i]!.x, pts[i]!.y);
    cx.stroke();
    cx.setLineDash([]);
    cx.shadowBlur = 0;
  }
  // Капсулы шагов: стопка вправо от точки; «~T» — под последней капсулой точки.
  // Стопка капсул и место подписи «~T» — правила в `chainPathLayout.ts` (REFM-71).
  const stack = stackIndexes(tl.map((r) => r.pointId));
  const lastAt = lastStepAtPoint(tl.map((r) => r.pointId));
  const last = new Map<string, { x: number; y: number; endH: number | null }>();
  cx.textAlign = 'center';
  for (let i = 0; i < steps.length; i++) {
    const pid = tl[i]!.pointId;
    const pl = pid ? s.planets[pid] : undefined;
    const k = stack[i];
    if (!pid || !pl || k === null || k === undefined) continue;
    const c = world(pl.position);
    if (!visible(c)) continue;
    const { x: bx, y: by } = capsuleAt(c, k);
    cx.fillStyle = 'rgba(6,18,22,.92)';
    cx.strokeStyle = rgba(LOCK, 0.85);
    cx.lineWidth = 1.2;
    cx.beginPath();
    cx.arc(bx, by, 9, 0, TAU);
    cx.fill();
    cx.stroke();
    cx.fillStyle = rgba(LOCK, 0.95);
    cx.font = '700 10px ui-monospace,Menlo,monospace';
    cx.fillText(stepGlyph(steps[i]!), bx, by + 3.5);
    const hrs = stepHours(steps[i]!);
    if (hrs) {
      cx.font = '600 8px ui-monospace,Menlo,monospace';
      cx.fillText(hrs, bx, by - 12);
    }
    // «~T» — под ПОСЛЕДНЕЙ капсулой точки: время точки это когда она отработана целиком.
    if (lastAt.get(pid) === i) last.set(pid, { x: bx, y: by, endH: tl[i]!.endH });
  }
  cx.font = '600 9px ui-monospace,Menlo,monospace';
  for (const p of last.values()) {
    if (p.endH === null) continue;
    cx.shadowColor = 'rgba(0,0,0,0.85)';
    cx.shadowBlur = fxBlur(3);
    cx.fillStyle = rgba(LOCK, 0.95);
    cx.fillText(`~${fmtEta(p.endH)}`, p.x, p.y + 20);
    cx.shadowBlur = 0;
  }
  cx.restore();
}
/** CHAIN-UX: слой цепочек — отправленные планы всех своих флотов (голова
 *  авторитетна: летящий — по arrivesAt, взведённая задержка — по waitUntil) и
 *  черновик открытого режима поверх. ◎-бейдж на якоре плана — хэндл: тап вне
 *  режима открывает редактирование. */
export function drawChainOverlay(now: number): void {
  const s = game.world();
  const cx = game.ctx();
  const ME = game.me();
  chainHits = [];
  const col = ownerColor(ME);
  // Отбор, группировка и счётчик бейджа — `chainBadges.ts` (REFM-73).
  const pulse = badgePulse(now);
  const orders = (s as { orders?: Record<string, { steps: ChainStep[]; waitUntil?: number }> })
    .orders;
  const editing = new Set(chainMode?.fleetIds ?? []);
  // Порядок обхода — по id флота: бейджи не должны переставляться между кадрами.
  const own: Array<{ fleetId: string; owner: string | null; fleet: Fleet }> = [];
  for (const fid of Object.keys(orders ?? {}).sort()) {
    const f = s.fleets[fid];
    if (f) own.push({ fleetId: fid, owner: f.owner, fleet: f });
  }
  // Якорь считается только для показываемых планов — чужие кадр не нагружают.
  const anchored: AnchoredOrder[] = shownOrders(own, ME, editing).map((e) => {
    const chain = orders![e.fleetId]!;
    const st = chainStart(e.fleet);
    const headRem =
      chain.waitUntil !== undefined ? Math.max(0, (chain.waitUntil - s.time) / HOUR) : undefined;
    drawChainPath(e.fleet, chain.steps, st.fromId, st.baseH, headRem, 0.5);
    const anchor = draftFinish(chain.steps, st.fromId);
    return { fleetId: e.fleetId, anchor: anchor && s.planets[anchor] ? anchor : null };
  });
  const byWorld = groupByAnchor(anchored);
  for (const [wid, fids] of byWorld) {
    const c = world(s.planets[wid]!.position);
    if (!visible(c)) continue;
    const bx = c.x;
    const by = c.y + BADGE_DY;
    cx.save();
    cx.shadowColor = rgba(col, 0.8);
    cx.shadowBlur = fxBlur(3 + 6 * pulse);
    cx.fillStyle = 'rgba(6,18,22,.92)';
    cx.strokeStyle = rgba(col, 0.9);
    cx.lineWidth = 1.4;
    cx.beginPath();
    cx.arc(bx, by, 7.5, 0, TAU);
    cx.fill();
    cx.stroke();
    cx.shadowBlur = 0;
    cx.beginPath();
    cx.arc(bx, by, 2.6, 0, TAU);
    cx.stroke();
    const count = badgeCount(fids.length);
    if (count) {
      cx.fillStyle = rgba(col, 0.95);
      cx.font = '700 8px ui-monospace,monospace';
      cx.textAlign = 'center';
      cx.fillText(count, bx + 11, by - 5);
    }
    cx.restore();
    chainHits.push({ target: wid, fleetIds: fids, x: bx, y: by });
  }
  // Черновик открытого режима — ярче отправленных; точка меню подсвечена кольцом.
  if (chainMode) {
    const f0 = s.fleets[chainMode.fleetIds[0]!];
    if (f0) {
      const st = chainStart(f0);
      drawChainPath(f0, chainMode.steps, st.fromId, st.baseH, undefined, 0.95);
    }
    const a = chainMenuAnchor();
    if (a) {
      cx.save();
      cx.strokeStyle = rgba(LOCK, 0.5 + 0.4 * pulse);
      cx.lineWidth = 1.6;
      cx.setLineDash([5, 4]);
      cx.lineDashOffset = -(now / 50) % 9;
      cx.beginPath();
      cx.arc(a.x, a.y, 17, 0, TAU);
      cx.stroke();
      cx.restore();
    }
  }
}
