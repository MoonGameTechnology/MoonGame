/**
 * Наложения карты (REFM-233, часть 1): то, что кадр рисует поверх карты и флотов и что
 * стоит на ней без взведённого прицела, — уголки захваченной цели, волны боя, сеть Роя,
 * маршруты своих флотов, трассы вылетов, круги патрулей, коридоры героев, радиусы оружия
 * и ПКО и круги способностей.
 *
 * Своего состояния у модуля нет: что рисовать, решают чистые модели (`combatRanges.ts`,
 * `patrolMarks.ts`, `corridorView.ts` и соседи), здесь только холст. Мир, своё место,
 * контекст кадра, часы карты, кольца ПКО из кэша кадра и эскадру взведённого прицела
 * модуль получает хуками {@link initMapOverlays}: они живут в `main.ts`, и импорт оттуда
 * был бы циклом. Зовут его кадр `render()` и прицелы `mapAim.ts`: круги и уголки у них
 * те же.
 */
import type { GameState, ShuttleStrike, Squadron } from '../../packages/shared-core/src/index';
import { legT, roadAhead } from '../../packages/shared-core/src/index';
import { drawShipShape } from '../../packages/client/src/shipShapes';
import { rgba } from '../../packages/client/src/holoDraw';
import { patrolMarks } from '../../decisions/patrolMarks';
import { routeShown, routeStroke } from '../../decisions/fleetRoute';
import { swarmNetMarks } from '../../decisions/swarmNetMarks';
import { abilityRings } from './abilityRings';
import { BATTLE_RINGS, phaseLook, ringPhase, ringRadiusAt } from './battleMark';
import { aimRing, combatRanges, ringLook, type RangeRing } from './combatRanges';
import { corridorLines } from './corridorView';
import { fleetOriginPx, fleetPos, selectedFleetIds, strikeBasePos, strikeWorldPos } from './fleetGeometry';
import { countdownHMS, fmtHrs } from './format';
import { HOUR, data } from './game';
import { fxBlur, fxBreath } from './graphicsPrefs';
import { selFleet, selFleets, selPlanet, selStrike, strikeAim } from './interaction';
import { cam, visible, world, worldDist } from './mapCamera';
import { known, vision } from './mapFog';
import { ABILITY_RING, CORR_LIVE, CORR_ONCE, LOCK, R_AA, R_ARTY, R_WING, TAU, ownerColor } from './mapPalette';
import { bracketStrokes } from './mapShapes';
import { squadronCallsignOf } from './squadronPanel';
import { strikeTrails } from './strikeTrail';
import { dominantUnit, unitShape } from './unitGlyphs';

/** Эскадра взведённого прицела удара: из ангара или в воздухе. */
export interface AimedSquadron {
  sq: Squadron;
  base: { planetId: string } | { fleetId: string };
  aloft: ShuttleStrike | null;
}

/** Что наложениям нужно от игры. */
export interface MapOverlaysHost {
  /** Мир, который показывает кадр. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Контекст канваса карты. */
  ctx(): CanvasRenderingContext2D;
  /** Часы карты: в сети — показанное время сервера, в соло — время мира. */
  now(): number;
  /** Отметки ПКО этого мира — из кэша кадра, раз на мир. */
  aa(): RangeRing[];
  /** Эскадра взведённого прицела удара; не взведён — `null`. */
  aimSquadron(): AimedSquadron | null;
}

let game: MapOverlaysHost;

/** Подключить наложения к игре. Зовётся из `main.ts` один раз, до первого кадра. */
export function initMapOverlays(host: MapOverlaysHost): void {
  game = host;
}

/** Stable corner brackets keep the picked object's position unambiguous. */
export function targetBrackets(x: number, y: number, r: number, t: number, color = LOCK) {
  const cx = game.ctx();
  cx.save();
  cx.translate(x, y);
  cx.globalAlpha = fxBreath(t, { period: 1800, base: 0.9, amp: 0.1, phase: 0 });
  cx.strokeStyle = color;
  cx.lineWidth = 1.6;
  cx.shadowColor = color;
  cx.shadowBlur = fxBlur(3);
  // Четыре уголка «захваченной цели» — их геометрию считает `mapShapes.ts`.
  for (const b of bracketStrokes(r, 6)) {
    cx.beginPath();
    cx.moveTo(b.from.x, b.from.y);
    cx.lineTo(b.corner.x, b.corner.y);
    cx.lineTo(b.to.x, b.to.y);
    cx.stroke();
  }
  cx.restore();
}

export function drawBattlePulse(
  x: number,
  y: number,
  pulse: number,
  phase: 'orbital' | 'ground' = 'orbital',
) {
  const cx = game.ctx();
  // Two DIFFERENT pictures for the two battle phases (the audit found them
  // indistinguishable): orbital = the familiar red expanding rings (a dogfight in
  // space); ground = an amber pulse hugging the surface + a flat "front line" bar.
  // Вид фазы и волна колец — `battleMark.ts` (REFM-118): фазы обязаны быть НЕПОХОЖИМИ,
  // а три кольца со сдвигом на треть читаются как расходящаяся волна, а не как мигание.
  const look = phaseLook(phase);
  const col = look.color;
  cx.save();
  cx.shadowColor = col;
  cx.shadowBlur = fxBlur(12);
  for (let i = 0; i < BATTLE_RINGS; i++) {
    const k = ringPhase(pulse, i);
    cx.strokeStyle = rgba(col, 0.55 * (1 - k));
    cx.lineWidth = 1.2 + i * 0.25;
    cx.beginPath();
    if (look.dash) cx.setLineDash([...look.dash]);
    cx.arc(x, y, ringRadiusAt(look, k), 0, TAU);
    cx.stroke();
  }
  if (look.frontLine) {
    cx.setLineDash([]);
    cx.strokeStyle = rgba(col, 0.85);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(x - 10, y + 16);
    cx.lineTo(x + 10, y + 16); // the front line under the world
    cx.stroke();
  }
  cx.restore();
}

/**
 * Сеть Роя на карте (`docs/swarm-behavior.md`): круги связи центров данных и
 * ретрансляторов, которые игрок видит, и линии между сошедшимися кругами. Что и как
 * показывать — `decisions/swarmNetMarks.ts`: только разведанное, без питания и знания.
 */
export function drawSwarmNet(): void {
  const cx = game.ctx();
  const s = game.world();
  const npc = s.pve?.npcPlayerId;
  if (!npc) return;
  const marks = swarmNetMarks(s, data, known);
  if (marks.nodes.length === 0) return;
  const col = ownerColor(npc);
  const at = marks.nodes.map((n) => world({ x: n.x, y: n.y }));
  cx.save();
  cx.setLineDash([2, 6]);
  cx.lineWidth = 1;
  cx.strokeStyle = rgba(col, 0.28);
  for (const [a, b] of marks.links) {
    cx.beginPath();
    cx.moveTo(at[a]!.x, at[a]!.y);
    cx.lineTo(at[b]!.x, at[b]!.y);
    cx.stroke();
  }
  cx.setLineDash([6, 8]);
  marks.nodes.forEach((n, i) => {
    cx.strokeStyle = rgba(col, n.kind === 'center' ? 0.5 : 0.35);
    cx.lineWidth = n.kind === 'center' ? 1.4 : 1;
    cx.beginPath();
    cx.arc(at[i]!.x, at[i]!.y, worldDist(n.r), 0, TAU);
    cx.stroke();
  });
  cx.restore();
}

/** The planned route of every moving fleet of mine — dashed, brighter if selected. */
export function drawFleetRoutes() {
  const cx = game.ctx();
  const s = game.world();
  const ME = game.me();
  for (const f of Object.values(s.fleets)) {
    // Чей маршрут виден, где он кончается и как выглядит — `fleetRoute.ts` (REFM-95);
    // здесь остаётся проекция мировых точек на экран.
    if (!routeShown(f.owner, ME, !!f.movement) || !f.movement) continue;
    const start = fleetOriginPx(f);
    if (!start) continue;
    const sel = selFleet === f.id || selFleets.has(f.id);
    // Путь впереди — по ДОРОГАМ, тем же правилом развилок, что водит флот ядро
    // (`roadAhead`, ROADS-2): линия не обещает дорогу, по которой флот не полетит.
    const ahead = roadAhead(s, f.movement, legT(f.movement, game.now())).slice(1);
    const pts = [{ x: start.x, y: start.y }, ...ahead.map((p) => world(p))];
    if (pts.length < 2) continue;
    const stroke = routeStroke(sel);
    cx.save();
    cx.setLineDash([4, 6]);
    cx.strokeStyle = rgba(LOCK, stroke.alpha);
    cx.lineWidth = stroke.width;
    cx.shadowColor = LOCK;
    cx.shadowBlur = fxBlur(stroke.blur);
    cx.beginPath();
    cx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i]!.x, pts[i]!.y);
    cx.stroke();
    const d = pts[pts.length - 1]!;
    cx.setLineDash([]);
    cx.beginPath();
    cx.arc(d.x, d.y, 4, 0, TAU);
    cx.stroke();
    cx.restore();
  }
}

/**
 * ЛЕТЯЩИЕ ВЫЛЕТЫ (остаток SHU-3.1) — трасса и значок эскадры на ней.
 *
 * Что рисовать и куда — `strikeTrail.ts` (чистое, под гейтом): свои вылеты и только
 * они, концы живые, ход по времени мира. Здесь остаётся канва.
 *
 * Вид намеренно НЕ такой, как у маршрута флота: маршрут — это план, который игрок ещё
 * волен отменить, а вылет уже в воздухе и отменить его нельзя. Отсюда сплошная линия
 * вместо пунктира плана и цвет крыла (`R_WING`), а не цвет захвата.
 */
export function drawStrikeTrails(now: number): void {
  const cx = game.ctx();
  const s = game.world();
  const ME = game.me();
  const trails = strikeTrails(s.strikes, { me: ME, now: game.now(), basePos: strikeBasePos });
  if (!trails.length) return;
  cx.save();
  for (const tr of trails) {
    const a = world(tr.from);
    const b = world(tr.to);
    const m = world(tr.at);
    if (!visible(a, 160) && !visible(b, 160)) continue;
    // Обратная нога БЛЕДНЕЕ: удар уже случился, и путь домой не требует внимания так,
    // как путь к цели, — иначе возвращающееся звено кричало бы громче летящего в бой.
    // Выбранная эскадра (SHU-6.14) ярче любой ноги: игрок смотрит на её курс.
    const picked = tr.id === selStrike;
    const alpha = picked ? 0.85 : tr.leg === 'back' ? 0.3 : 0.55;
    cx.strokeStyle = rgba(R_WING, alpha);
    cx.lineWidth = 1.1;
    cx.setLineDash([]);
    cx.shadowColor = R_WING;
    cx.shadowBlur = fxBlur(6);
    cx.beginPath();
    cx.moveTo(a.x, a.y);
    cx.lineTo(b.x, b.y);
    cx.stroke();
    // Тот же корпус, что в ангаре: перехватчик, бомбардировщик или десантный челнок.
    // Фильтр своих вылетов уже выполнен в strikeTrails; чужой состав сюда не попадает.
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const dom = dominantUnit(tr.units, data);
    cx.save();
    cx.translate(m.x, m.y);
    cx.rotate(ang + Math.PI / 2);
    cx.scale(0.68, 0.68);
    cx.translate(-12, -12);
    cx.fillStyle = rgba(R_WING, 0.24);
    cx.strokeStyle = rgba(R_WING, tr.leg === 'back' ? 0.55 : 0.95);
    drawShipShape(
      cx,
      (dom && unitShape(dom.def, dom.unit, s.players[ME]?.faction)) || 'fighter',
      cam.scale >= 0.9,
    );
    cx.restore();
    // Подпись — позывной и число бортов, ТОТ ЖЕ позывной, что у карточки в порту:
    // игрок обязан узнать в летящем значке звено, которое отправлял.
    if (cam.scale >= 0.9) {
      cx.setLineDash([]);
      cx.shadowBlur = 0;
      cx.fillStyle = rgba(R_WING, tr.leg === 'back' ? 0.5 : 0.8);
      cx.font = '10px ui-monospace, monospace';
      cx.textAlign = 'center';
      cx.fillText(`${squadronCallsignOf(tr.squadronId)} ·${tr.machines}`, m.x, m.y - 9);
      cx.textAlign = 'start';
    }
    // Рамка выбора — та же, что у выбранного флота: эскадра в воздухе выделяется как он.
    if (picked) targetBrackets(m.x, m.y, 13, now);
  }
  cx.restore();
}

/**
 * КРУГИ ПАТРУЛЕЙ (SHU-6.3) — где свои эскадры держат небо и сколько ещё.
 *
 * Что считается патрулём и чей он — `patrolMarks.ts`; здесь только канва. Цвет крыла
 * (`R_WING`), как у трассы: это та же эскадра, только не в пути, а над точкой. Патруль на
 * пути к точке — пунктир: круг ещё не работает. Висящий — сплошной круг и отсчёт до
 * разворота под значком, на тёмной плашке (тот же приём, что у осады, `drawDevourSieges`):
 * значок стоит в центре круга, и отсчёт держится рядом с ним при любом зуме.
 */
export function drawPatrolRings(): void {
  const cx = game.ctx();
  const s = game.world();
  const ME = game.me();
  const marks = patrolMarks(s.strikes, { me: ME, now: game.now() });
  if (!marks.length) return;
  cx.save();
  cx.font = '700 11px ui-monospace, monospace';
  cx.textAlign = 'center';
  cx.textBaseline = 'top';
  for (const m of marks) {
    const c = world(m.at);
    const r = worldDist(m.radius);
    if (!visible(c, r + 40)) continue;
    drawPatrolCircle(c, r, m.active ? 'live' : 'route');
    if (m.leftMs === null) continue;
    const label = countdownHMS(m.leftMs);
    const w = Math.ceil(cx.measureText(label).width) + 10;
    const top = Math.round(c.y + 11);
    const left = Math.round(c.x - w / 2);
    cx.fillStyle = 'rgba(4,10,12,.85)';
    cx.fillRect(left, top, w, 15);
    cx.fillStyle = rgba(R_WING, 0.95);
    cx.fillText(label, c.x, top + 2);
  }
  cx.restore();
}

/** Как выглядит круг патруля: висящий (`live`) — сплошной, с заливкой; летящий к точке
 *  (`route`) — бледный пунктир, круг ещё не работает; под указателем (`aim`) — яркий
 *  пунктир прицела (`ringLook('aim')`): это режим, в котором игрок прямо сейчас. */
const PATROL_LOOK = {
  live: { dash: [] as number[], alpha: 0.6, width: 1.2, fill: 0.06 },
  route: { dash: [6, 6], alpha: 0.45, width: 1.2, fill: 0 },
  aim: { dash: [7, 5], alpha: 0.85, width: 1.6, fill: 0.08 },
};

/** Сам круг патруля: у прицела (`drawPatrolAim`) и у метки на карте радиус один и тот же
 *  (`patrol.radius` снят с того же `squadronPatrol`), иначе игрок целится по одной
 *  окружности, а висеть эскадра будет в другой. */
export function drawPatrolCircle(
  c: { x: number; y: number },
  rPx: number,
  look: keyof typeof PATROL_LOOK,
  tone = R_WING,
): void {
  const cx = game.ctx();
  if (rPx <= 0) return;
  const k = PATROL_LOOK[look];
  cx.save();
  cx.setLineDash(k.dash);
  cx.lineWidth = k.width;
  cx.strokeStyle = rgba(tone, k.alpha);
  cx.beginPath();
  cx.arc(c.x, c.y, rPx, 0, TAU);
  if (k.fill > 0) {
    cx.fillStyle = rgba(tone, k.fill);
    cx.fill();
  }
  cx.stroke();
  cx.restore();
}

/**
 * ЧУЖИЕ ПАТРУЛИ В ОБЗОРЕ (SHU-6.10) — кто держит небо рядом со мной и чем.
 *
 * Кого видно, решает ядро (`patrolsSeenBy`): в сети — проекция сервера, в соло — то же
 * правило по полному миру. Здесь только канва: сплошной круг цветом хозяина (враг,
 * союзник, нейтрал — та же палитра, что у его флотов), в центре корпус ведущей машины и
 * число бортов. Отсчёта нет: срок висения чужого патруля наблюдателю не виден.
 */
export function drawSeenPatrols(): void {
  const cx = game.ctx();
  const s = game.world();
  const seen = vision?.seenPatrols ?? [];
  if (!seen.length) return;
  cx.save();
  for (const p of seen) {
    const c = world(p.at);
    const r = worldDist(p.radius);
    if (!visible(c, r + 40)) continue;
    const tone = ownerColor(p.owner);
    drawPatrolCircle(c, r, 'live', tone);
    const dom = dominantUnit(p.units, data);
    cx.save();
    cx.translate(c.x, c.y);
    cx.scale(0.68, 0.68);
    cx.translate(-12, -12);
    cx.fillStyle = rgba(tone, 0.24);
    cx.strokeStyle = rgba(tone, 0.95);
    drawShipShape(
      cx,
      (dom && unitShape(dom.def, dom.unit, s.players[p.owner]?.faction)) || 'fighter',
      cam.scale >= 0.9,
    );
    cx.restore();
    if (cam.scale >= 0.9) {
      const machines = p.units.reduce((n, u) => n + u.count, 0);
      cx.fillStyle = rgba(tone, 0.8);
      cx.font = '10px ui-monospace, monospace';
      cx.textAlign = 'center';
      cx.fillText(`·${machines}`, c.x, c.y - 9);
      cx.textAlign = 'start';
    }
  }
  cx.restore();
}

/**
 * HERO-CORRIDOR — временные коридоры героев на карте.
 *
 * До этого их не рисовали ВООБЩЕ: статический слой лейн строится из `MAP`, а коридор
 * живёт в состоянии, поэтому игрок не видел ни что коридор открыт, ни куда он ведёт.
 *
 * Что и почему различается — решает чистая модель `corridorView.ts`; здесь только
 * канва. Одноразовый мигает красным и БЕЗ таймера (он закрывается прибытием армии, а
 * не по часам — цифра «осталось» была бы враньём); временный и общий идут спокойной
 * линией с оставшимся сроком.
 */
export function drawCorridors(now: number): void {
  const cx = game.ctx();
  const s = game.world();
  const ME = game.me();
  const lines = corridorLines(s, ME, s.time, known);
  if (!lines.length) return;
  cx.save();
  for (const line of lines) {
    const a = s.planets[line.from]?.position;
    const b = s.planets[line.to]?.position;
    if (!a || !b) continue;
    const p1 = world(a);
    const p2 = world(b);
    const col = line.blink ? CORR_ONCE : CORR_LIVE;
    // Мигание — только у одноразового: он вот-вот исчезнет, и это надо чувствовать.
    const pulse = line.blink ? 0.35 + 0.45 * Math.abs(Math.sin(now / 320)) : 0.6;
    cx.strokeStyle = rgba(col, line.mine ? pulse : pulse * 0.6);
    cx.lineWidth = line.mine ? 2 : 1.4;
    cx.setLineDash(line.blink ? [7, 6] : [10, 6]);
    cx.shadowColor = col;
    cx.shadowBlur = fxBlur(line.blink ? 8 : 4);
    cx.beginPath();
    cx.moveTo(p1.x, p1.y);
    cx.lineTo(p2.x, p2.y);
    cx.stroke();
    cx.shadowBlur = 0;
    if (line.msLeft !== null) {
      cx.setLineDash([]);
      cx.fillStyle = rgba(col, 0.9);
      cx.font = '600 11px ui-monospace,monospace';
      cx.textAlign = 'center';
      cx.fillText(fmtHrs(line.msLeft / HOUR), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 6);
    }
  }
  cx.setLineDash([]);
  cx.restore();
}

/**
 * RANGE-UX — круги досягаемости выделенных флотов и выбранного мира, отметки ПКО и круг
 * ВЗВЕДЁННОГО прицела (остаток SHU-3.1).
 *
 * Вся арифметика — в `combatRanges.ts` (чистая, покрыта гейтом); здесь только канва.
 * Радиусы приходят ИЗ ЯДРА — рисуется ровно тот круг, по которому ядро стреляет.
 * Базы обоих видов (SHU-6.1): мир с портом или ангаром крепости и корабль, у которого
 * эскадры едут в трюме.
 */
export function drawCombatRanges(): void {
  const cx = game.ctx();
  const s = game.world();
  const ME = game.me();
  const ids = selectedFleetIds();
  const { rings } = combatRanges(
    s,
    data,
    ids,
    ME,
    (id: string) => {
      const f = s.fleets[id];
      if (f) return fleetPos(f);
      const p = s.planets[id];
      return p ? { ...p.position } : null;
    },
    known,
    selPlanet,
    game.aa(),
  );
  // Круг ВЗВЕДЁННОГО прицела (остаток SHU-3.1) — рядом с пассивными радиусами, потому
  // что это тот же вопрос «докуда дотянется», только про конкретное звено и здесь и
  // сейчас. Дальность — `squadronReach` ядра, та самая, по которой оно отобьёт промах;
  // у перелёта (SHU-6.5) — `squadronFerryRange`, по которой ядро отбивает его.
  // Эскадра в воздухе (SHU-6.14) меряет удар и патруль от той же базы — ядро держит
  // радиус от неё, — а перелёт от себя: лететь ей оттуда, где она сейчас.
  const aiming = game.aimSquadron();
  const aimAt = aiming
    ? aiming.aloft && strikeAim?.relocate
      ? strikeWorldPos(aiming.aloft.id)
      : 'planetId' in aiming.base
        ? (s.planets[aiming.base.planetId]?.position ?? null)
        : ((f) => (f ? fleetPos(f) : null))(s.fleets[aiming.base.fleetId])
    : null;
  const aim =
    aiming && aimAt
      ? aimRing({ squadron: aiming.sq, at: aimAt, relocate: !!strikeAim?.relocate }, data)
      : null;
  if (aim) rings.push(aim);
  if (!rings.length) return;
  const tint: Record<string, string> = { shuttle: R_WING, aa: R_AA, aim: R_WING };
  cx.save();
  for (const ring of rings) {
    const c = world({ x: ring.x, y: ring.y } as never);
    // Заметность кольца — `combatRanges.ts` (REFM-123): ПКО заметнее радиуса вылета,
    // потому что это отметка на мире, а не область.
    const look = ringLook(ring.kind);
    cx.strokeStyle = rgba(tint[ring.kind] ?? R_ARTY, look.alpha);
    cx.lineWidth = look.width;
    cx.setLineDash([...look.dash]);
    cx.beginPath();
    if (ring.radius > 0) cx.arc(c.x, c.y, worldDist(ring.radius), 0, TAU);
    // ПКО: у него нет области — только «у этого мира есть зубы».
    else cx.arc(c.x, c.y, 13, 0, TAU);
    cx.stroke();
  }
  cx.setLineDash([]);
  cx.restore();
}

/**
 * ОДИН вид у радиуса способности: фиолетовый пунктир (заказ владельца). Он нарочно не
 * похож ни на дальность огня (`R_ARTY`/`R_WING`), ни на радар — иначе на карте, где
 * колец и так много, игрок не отличит «докуда бьёт пушка» от «докуда достаёт аура».
 * Рисуется и под прицелом, и у уже наложенных эффектов — потому и вынесено сюда, а не
 * скопировано дважды.
 */
export function drawAbilityCircle(x: number, y: number, rPx: number, fill = 0): void {
  const cx = game.ctx();
  if (rPx <= 0) return;
  cx.save();
  cx.setLineDash([7, 6]);
  cx.lineWidth = 1.5;
  cx.strokeStyle = rgba(ABILITY_RING, 0.85);
  cx.beginPath();
  cx.arc(x, y, rPx, 0, TAU);
  if (fill > 0) {
    cx.fillStyle = rgba(ABILITY_RING, fill);
    cx.fill();
  }
  cx.stroke();
  cx.setLineDash([]);
  cx.restore();
}

/** Уже РАБОТАЮЩИЕ способности: аура следует за героем, скан прибит к своему узлу.
 *  Модель — `abilityRings.ts`; здесь только холст. Просроченный круг гаснет в тот же
 *  кадр: срок проверяется по игровому времени, а не по таймеру интерфейса. */
export function drawAbilityRings(): void {
  const s = game.world();
  const ME = game.me();
  const rings = abilityRings(s, ME, s.time, {
    hero: (heroId) => {
      const hero = (s.heroes ?? {})[heroId];
      const f = hero?.fleetId ? s.fleets[hero.fleetId] : undefined;
      return f ? fleetOriginPx(f) : null;
    },
    node: (planetId) => {
      const p = s.planets[planetId]?.position;
      return p ? world(p) : null;
    },
  });
  for (const r of rings) drawAbilityCircle(r.x, r.y, worldDist(r.radius));
}
