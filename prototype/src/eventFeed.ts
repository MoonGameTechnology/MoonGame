/**
 * Реакция на события мира и лента (REFM-230): то, чем интерфейс матча отвечает на поток
 * доменных событий. Строка ленты и тост (`note`, `toast`), журнал матча и его зеркало для
 * сводки возвращения (`logLines`, `eventLog`), итоги боёв с ведомостью потерь и счётом
 * войны (`killStats`) и сам разбор пакета событий (`handleEvents`). Его зовут и локальный
 * ход прототипа, и снимок сервера.
 *
 * Правила адресатов и текстов живут в чистых модулях рядом (`eventVisibility.ts`,
 * `battleLog.ts`, `gainNews.ts`, `fleetNews.ts` и другие); здесь только их проводка.
 * Мир на экране, своё место, имена, выбор флота и окна живут в `main.ts`, рассказы о
 * вахте, герое и стройке — там же, в зоне конвейера приказа (REFM-240, линия Б), а залпы,
 * вспышки и пульс союзника — у карты. Модуль получает их хуками {@link initEventFeed}:
 * импорт оттуда был бы циклом.
 */
import type {
  DiplomaticStance,
  DomainEvent,
  GameState,
  StrikeBase,
} from '../../packages/shared-core/src/index';
import { engagementOf, flashBattles, inVisionBloc } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { refusalText as errText } from '../../decisions/refusalText';
import { hitKey, seenPatrolOver, shuttleHitView } from '../../decisions/shuttleHit';
import { splitSelectTarget } from '../../decisions/splitFollow';
import { battleOutcome, battlePhaseKey, lossTally } from './battleLog';
import type { BuildLogKind } from './buildLog';
import {
  declineHeard,
  diploConcernsMe,
  offerAudience,
  offerUnread,
  stanceKey,
  stanceThread,
} from './diploAudience';
import { diploOpen, diploTab, isAiSeat, pushSpyLog, renderDiplo, stanceRu } from './diploWindow';
import { isMine, seen, seenTail } from './eventVisibility';
import { aaImpact, type XY } from './fireEffects';
import { flakTier, type FlakTier } from './flakTiers';
import { fleetAnchor, fleetPos, strikeBasePos, strikeWorldPos } from './fleetGeometry';
import { destroyHeard, reorgHeard, reorgKey, tradeHeard, tradeSide } from './fleetNews';
import { costText, countdownHMS, displayUnit, gameStamp, TECH_CUR } from './format';
import { captureHeard, gainRepaint, researchHeard } from './gainNews';
import { data } from './gameData';
import { heroDiedNews, heroRespawnedNews, type HeroNews } from './heroNews';
import { jumpToPing, unworld } from './mapCamera';
import { admits, fleetKnown, fleetNode, known, rememberScan, vision } from './mapFog';
import { markUnread, pushMsg } from './messageLog';
import { EVENT_LOG_MAX, isRepeat, LOG_LINES, pushBounded } from './noteLog';
import type { RecapEvent } from './recap';
import { sectorRunActive } from './sectorRun';
import { bootyKind, bootyText, counterLine, spyRepaint } from './spyLog';
import { squadronCallsignOf } from './squadronPanel';
import { stewardMine, type StewardEvent } from './stewardLog';
import { TOAST_FADE_MS, TOAST_LIFE_MS, toastClass, toastOverflow, toastText } from './toastView';
import { recordLoss, tallyDeath } from './warTally';
import { timeLeft } from './worldQueries';

/** Залп на карте: концы в координатах карты на момент события, момент и тир огня. */
export interface FlakShot {
  from: XY;
  to: XY;
  at: number;
  tier: FlakTier;
}

/** Окно, которое событие перерисовывает, если оно открыто. */
interface Repaintable {
  isOpen(): boolean;
  repaint(): void;
}

/** Что ленте нужно от игры. Мир, место, имена, выбор, окна и рассказы — в `main.ts`,
 *  огонь — у карты. */
export interface EventFeedHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Имена держав по месту. */
  names(): Record<string, string>;
  /** Имя мира для строки — с учётом тумана и переименований. */
  placeName(id: string): string;
  /** Имя соединения: «Флот «ПОЗЫВНОЙ»» или крепость. */
  fleetTitleOf(id: string): string;
  /** Выделить флоты. */
  setFleetSelection(ids: string[]): void;
  /** Флот, деления которого ждёт окно деления, или `null`. */
  splitAwait(): string | null;
  /** Деление дождались: больше не ждать. */
  endSplitAwait(): void;
  /** Древо технологий. */
  techTree(): Repaintable;
  /** Рассказать о событии вахты: опорный снимок и ночная разница. */
  tellSteward(kind: StewardEvent, p: Record<string, unknown>): void;
  /** Рассказать о своём герое: гибель со сроком возрождения и возвращение в строй. */
  tellHero(news: HeroNews | null): void;
  /** Рассказать о событии стройки. */
  tellBuild(kind: BuildLogKind, p: Record<string, unknown>): void;
  /** Окно боя: держит итог до закрытия. */
  battleWindow(): { ended(battleId: string, text: string): void };
  /** Залп на карту. */
  shot(shot: FlakShot): void;
  /** Вспышка захвата мира цветом нового владельца. */
  captureFlash(node: string, owner: string): void;
  /** Вспышка срабатывания мин на узле. */
  mineFlash(node: string, position: XY | undefined): void;
  /** Малая вспышка: своя постройка готова, свой флот дошёл. */
  noticeFlash(at: XY | null | undefined): void;
  /** Чип союзника мигает: встреча — приглашение открыть связь. */
  pulseAlly(): void;
}

let game: EventFeedHost;

/** Поднять ленту: хуки игры. Зовётся из `main.ts` один раз, до первой строки ленты. */
export function initEventFeed(host: EventFeedHost): void {
  game = host;
}

/** Журнал матча — строки ленты с игровой меткой времени (предел — `noteLog.ts`). */
export const logLines: string[] = [];

// Session war record (from `unit.died` events): enemy units you destroyed vs your own
// units lost. Cumulative since the match started; reset on a new match. Only battles
// YOU take part in are counted (tracked by location via battle.started/resolved), so
// the AI's fights elsewhere don't inflate your tally.
export let killStats = { destroyed: 0, lost: 0 };
const myBattleLocs = new Set<string>();

// Casualties per contested location (owner → unit → count), accumulated from
// unit.died while a battle runs and paid out as a result note on battle.resolved.
const battleLosses = new Map<string, Record<string, Record<string, number>>>();

// ONB-5: a structured, bounded mirror of the event log — feeds the return digest.
export const eventLog: RecapEvent[] = [];
let lastNoteMsg = '';
let lastNoteAtMs = 0;
/** Append a line to the session log (bounded). Patches the feed if it's on screen. */
export function note(msg: string, at?: string) {
  // Защита от повторов и пределы лент — `noteLog.ts` (REFM-101): повтор глушится по
  // РЕАЛЬНОМУ времени, а метка ставится ИГРОВОЕ — «День 3, 07:45» (`gameStamp`, UIX-5.3).
  const nowMs = Date.now();
  if (isRepeat(msg, lastNoteMsg, nowMs, lastNoteAtMs)) return;
  lastNoteMsg = msg;
  lastNoteAtMs = nowMs;
  pushBounded(logLines, `${gameStamp(game.world().time)} · ${msg}`, LOG_LINES);
  pushBounded(eventLog, { at: game.world().time, text: msg, anchor: at }, EVENT_LOG_MAX);
  toast(msg, at);
}

/** Transient event toast over the map — feedback must not live only in a hidden
 *  log window. Tap dismisses; with a map anchor the tap also flies the camera
 *  there (the jumpToPing path). At most 3 stacked, ~5s life each. */
export function toast(msg: string, at?: string): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  // Вид, предел стопки и время жизни — `toastView.ts` (REFM-105).
  const el = document.createElement('div');
  el.className = toastClass(!!at);
  el.textContent = toastText(msg, !!at);
  el.addEventListener('click', () => {
    if (at) jumpToPing(at);
    el.remove();
  });
  host.appendChild(el);
  // Считаются и вытесняются только тосты: предупреждение о сохранении стоит над ними.
  for (let extra = toastOverflow(host.querySelectorAll('.toast').length); extra > 0; extra--)
    host.querySelector('.toast')?.remove();
  window.setTimeout(() => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), TOAST_FADE_MS);
  }, TOAST_LIFE_MS);
}

/** Бои моего блока зрения, начало которых журнал уже показал: итог приходит, когда боя в
 *  состоянии нет, и спросить «мой ли он» тогда уже не у кого. */
const engagedBattleIds = new Set<string>();

/** Налёты по моим целям, о которых журнал уже написал (`decisions/shuttleHit.ts`, правило 4):
 *  патруль бьёт каждые 15 минут, а строка нужна одна на налёт. */
const announcedHits = new Set<string>();

/** Дерётся ли в бое `battleId` мой блок зрения — то же правило, что `battleKnown`, для
 *  событий: узел союзного боя может быть не опознан (замечание Codex на #1408). */
function battleEngaged(battleId: unknown): boolean {
  if (typeof battleId !== 'string') return false;
  if (engagedBattleIds.has(battleId) || vision?.engaged.battles.has(battleId)) return true;
  return (
    Object.hasOwn(game.world().battles, battleId) &&
    engagementOf(game.world(), game.me()).battles.has(battleId)
  );
}

export function handleEvents(events: DomainEvent[]) {
  // Мир, своё место и имена — хуками игры, раз на пакет: ни одна ветка ниже их не меняет.
  const s = game.world();
  const ME = game.me();
  const NAME = game.names();
  // Бои, начавшиеся и кончившиеся в этом пакете: в `s` их уже нет, и «мой ли он» отвечают
  // стороны из самих событий — тем же правилом, что сервер раздаёт их (замечание Codex на
  // #1417: мгновенный бой союзника на неопознанном узле журнал отбрасывал целиком).
  const flash = flashBattles(events, s);
  const flashSeen = (id: unknown): boolean =>
    typeof id === 'string' && inVisionBloc(s, ME, flash.get(id) ?? []);
  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    if (e.type.startsWith('rocketMine.') && (p.owner === ME || p.playerId === ME)) {
      const keys: Record<string, string> = {
        'rocketMine.ready': 'mine.ready',
        'rocketMine.cancelled': 'mine.cancelled',
        'rocketMine.launched': 'mine.launched',
        'rocketMine.intercepted': 'mine.intercepted',
        'rocketMine.hit': 'mine.hit',
        'rocketMine.disarmed': 'mine.disarmed',
      };
      const key = keys[e.type];
      if (key) note(t(key, { damage: Math.round(Number(p.damage) || 0) }));
    }
    switch (e.type) {
      case 'battle.started':
        // Видимость события — `eventVisibility.ts` (REFM-86): своё всегда, чужое только
        // на опознанном узле. Сеть фогует события на сервере, и местная симуляция обязана
        // повторять тот же фильтр — иначе соло показывает больше, чем сеть.
        if (
          seen(
            isMine([p.attacker as string, p.defender as string], ME),
            known(p.location as string) || battleEngaged(p.battleId) || flashSeen(p.battleId),
          )
        )
          // Чем названы строки боя — `battleLog.ts` (REFM-179): фаза называется ВСЕГДА,
          // потому что орбита и десант — разные бои с разными войсками.
          note(
            t('log.battle.start', {
              at: game.placeName(p.location as string),
              phase: t(battlePhaseKey(p.phase as string | undefined)),
            }),
            p.location as string,
          );
        // Свой бой запоминается: его исход обязан доехать до журнала, даже если узел
        // уйдёт под туман по ходу схватки (правило 3).
        if (isMine([p.attacker as string, p.defender as string], ME))
          myBattleLocs.add(p.location as string);
        if (typeof p.battleId === 'string' && (battleEngaged(p.battleId) || flashSeen(p.battleId)))
          engagedBattleIds.add(p.battleId);
        break;
      case 'battle.resolved': {
        const loc = p.location as string;
        // Потери сводятся ПО ИГРОКУ и приписываются, только если они есть (правила
        // 3–5 в `battleLog.ts`): пустой хвост «· потери:» — строка ни о чём.
        const tally = lossTally(battleLosses.get(loc), (who) => NAME[who] ?? who);
        const out = battleOutcome(p.winner as string | undefined);
        const endText =
          t('log.battle.end', {
            at: game.placeName(loc),
            res: out.named
              ? t(out.key, { who: NAME[p.winner as string] ?? (p.winner as string) })
              : t(out.key),
          }) + (tally ? t('log.battle.losses', { tally }) : '');
        if (seenTail(myBattleLocs.has(loc), known(loc) || battleEngaged(p.battleId)))
          note(endText, loc);
        // Окно на этом бою держит итог до закрытия (решение владельца 2026-09-25): бой у
        // планеты при осаде длится раунд-два, и окно пустело сразу после открытия.
        if (typeof p.battleId === 'string') game.battleWindow().ended(p.battleId, endText);
        battleLosses.delete(loc);
        myBattleLocs.delete(loc);
        if (typeof p.battleId === 'string') engagedBattleIds.delete(p.battleId);
        break;
      }
      case 'technology.researched':
        // Открытие слышит ТОЛЬКО исследователь — `gainNews.ts` (REFM-184): чужие
        // технологии это разведданные, за них в игре платят шпионажем.
        if (researchHeard(p.playerId, ME))
          note(
            t('log.tech.done', {
              tech: tData(
                data.technologies[p.technology as string]?.name ?? (p.technology as string),
              ),
            }),
          );
        // Перерисовка ВНЕ проверки адресата (правило 5): доступность узлов сдвинулась
        // оттого, что событие случилось, а не оттого, что игрок о нём услышал.
        if (gainRepaint('research').techTree && game.techTree().isOpen()) game.techTree().repaint();
        break;
      // «Хранитель» lifecycle: snapshot at delegation, diff on expiry (the morning report).
      // Что печатает каждое событие вахты и что делается с опорным снимком —
      // `stewardLog.ts` (REFM-176): всё только про СЕБЯ, поза меняет текст, снимок
      // берётся при постановке и гаснет и при снятии, и при возврате, ночная разница
      // печатается только если есть от чего считать, а ресурс несёт ГЛИФ, а не
      // HTML-чип (тост идёт через textContent, в ленту попадает и чужой текст).
      case 'steward.delegated':
        if (stewardMine(p.playerId, ME)) game.tellSteward('delegated', p);
        break;
      case 'steward.recalled':
        if (stewardMine(p.playerId, ME)) game.tellSteward('recalled', p);
        break;
      case 'steward.expired':
        if (stewardMine(p.playerId, ME)) game.tellSteward('expired', p);
        break;
      // Both espionage events are addressed to the ACTOR (`owner`); in NET play the
      // server's fog filter already withholds them from the victim — mirror it here.
      // Кому адресовано событие, что оно говорит и когда перерисовывается ростер —
      // `spyLog.ts` (REFM-177). SPY-2: успех и провал читает ИСПОЛНИТЕЛЬ, замеченную
      // операцию — ЖЕРТВА; пойманный вор называется по имени, неустановленный нет; у
      // кражи ростер перерисовывается ПОСЛЕ проверки адресата (появилась своя строка
      // разведки), у обнаружения — ДО неё (расположение бота двигается в любом случае).
      case 'intel.stolen': {
        if (p.owner !== ME) break;
        const b = bootyText(p.kind as string);
        const what =
          b.field === 'who'
            ? t(b.key, { who: NAME[p.target as string] ?? (p.target as string) })
            : t(b.key, { at: game.placeName(String(p.intelPlanet ?? p.target)) });
        note(t('log.spy.success', { what }));
        pushSpyLog(t('log.spy.success.short', { what }));
        if (spyRepaint('stolen') === 'after' && diploOpen && diploTab === 'diplo') renderDiplo();
        break;
      }
      case 'espionage.failed':
        if (p.owner === ME) {
          const whoF = NAME[p.target as string] ?? (p.target as string);
          note(t('log.spy.fail', { who: whoF }));
          pushSpyLog(t('log.spy.fail.short', { who: whoF }));
        }
        break;
      case 'espionage.detected': {
        if (spyRepaint('detected') === 'before' && diploOpen && diploTab === 'diplo') renderDiplo();
        if (p.owner !== ME) break;
        const what = t(bootyKind(p.kind as string));
        const c = counterLine(p.spy as string | undefined);
        const line = c.named
          ? t(c.key, { who: NAME[p.spy as string] ?? (p.spy as string), what })
          : t(c.key, { what });
        note(line);
        pushSpyLog(line);
        break;
      }
      case 'planet.captured':
        // Строку слышит только участник — взявший мир или тот, у кого его взяли
        // (`gainNews.ts`, правило 1, решение владельца 2026-10-06): чужой захват даже на
        // видимом мире — раскрытие информации, ему нет места ни в журнале, ни во
        // всплывающем сообщении, ни в сводке возвращения.
        if (captureHeard(p.owner, p.from, ME))
          note(
            t('log.capture', {
              who: NAME[p.owner as string] ?? (p.owner as string),
              at: game.placeName(p.planetId as string),
            }),
            p.planetId as string,
          );
        // Вспышка и память разведки — по видимости, а не по участию (правило 3):
        // перекраска видимого мира — наблюдение на карте, за туманом не мигает ничего.
        if (seen(isMine([p.owner as string], ME), known(p.planetId as string))) {
          // light the flipped province up in its new owner's colour (fog-gated: only
          // a capture we may see flashes) — re-capture restarts the wave.
          game.captureFlash(p.planetId as string, p.owner as string);
          // Захват, который игрок ВИДЕЛ, — это знание: записать его в память разведки.
          // Иначе потерянная провинция тем же кадром уходила в туман, заливка брала
          // владельца из снимка кадром раньше, и мир Роя оставался цвета игрока
          // (замечание владельца 2026-09-25: «прошла анимация перекраски — и всё равно зелёная»).
          rememberScan([p.planetId as string]);
        }
        // Тоже ВНЕ проверки видимости (`gainNews.ts`, правило 5): захват за туманом
        // всё равно сдвигает счёт держав, и ростер обязан сходиться с состоянием.
        if (gainRepaint('capture').roster && diploOpen && diploTab === 'diplo') renderDiplo();
        break;
      case 'diplomacy.changed': {
        const a = p.a as string;
        const b = p.b as string;
        const st = p.stance as DiplomaticStance;
        const na = NAME[a] ?? a;
        const nb = NAME[b] ?? b;
        // Кому адресована дипломатия — `diploAudience.ts` (REFM-182): у треда две
        // стороны, и чужой паре в нём места нет; у войны свой текст. Адрес треда
        // сохранён как есть — расхождение 2 в шапке модуля.
        if (diploConcernsMe(a, b, ME)) {
          const thread = stanceThread(a, b);
          pushMsg(
            thread.key,
            st === 'war'
              ? t(stanceKey(st), { a: na, b: nb })
              : t(stanceKey(st), { a: na, b: nb, stance: stanceRu(st).toLowerCase() }),
            true,
            thread.from,
          );
          // YAG-7.3 (решение владельца 2026-09-25): в забеге Sector Zero строки ленты нет.
          // Противник там один — Рой, и его объявление войны на старте штурма повторяло
          // «Экспедиция начата — Рой уже идёт» служебной строкой с именем фракции игрока.
          // Реплика в треде дипломатии выше остаётся.
          if (!sectorRunActive) note(`${na} → ${nb}: ${stanceRu(st)}`);
        }
        if (diploOpen && diploTab === 'diplo') renderDiplo();
        break;
      }
      case 'diplomacy.offered': {
        const from = p.from as string;
        const to = p.to as string;
        const st = p.stance as DiplomaticStance;
        // Кому адресовано предложение — `diploAudience.ts` (REFM-182): своё исходящее
        // объявляется, только если ответа надо ЖДАТЬ (бот отвечает в той же пачке, и
        // строка «отправлено» у него живёт долю секунды и читается как сбой).
        const heard = offerAudience(from, to, ME, isAiSeat(to));
        if (heard === 'incoming') {
          note(
            t('log.diplo.offer', {
              who: NAME[from] ?? from,
              stance: stanceRu(st),
            }),
          );
          pushMsg(from, t('log.diplo.offer.short', { stance: stanceRu(st) }), true, from);
        } else if (heard === 'sent') {
          note(
            t('log.diplo.sent', {
              who: NAME[to] ?? to,
              stance: stanceRu(st),
            }),
          );
        }
        if (offerUnread(heard)) markUnread();
        if (diploOpen && diploTab === 'diplo') renderDiplo();
        break;
      }
      case 'diplomacy.declined': {
        const from = p.from as string;
        const to = p.to as string;
        const st = p.stance as DiplomaticStance;
        // Отказ читает только предлагавший (`diploAudience.ts`, правило 5): отклонившему
        // сообщать нечего — он сам только что нажал «отказать».
        if (declineHeard(from, ME)) {
          pushMsg(
            to,
            t('log.diplo.rejected', {
              who: NAME[to] ?? to,
              stance: stanceRu(st),
            }),
            true,
            to,
          );
          note(t('log.diplo.rejected.short', { who: NAME[to] ?? to, stance: stanceRu(st) }));
        }
        if (diploOpen && diploTab === 'diplo') renderDiplo();
        break;
      }
      // RECAP-FOG. Стройка и производство ДРУГОГО игрока в мой журнал не попадают —
      // а журнал и есть источник сводки возвращения (`buildRecap`), так что чужая
      // экономика утекала и в дайджест, и в пуш. Сводка — про МОЮ империю; чужое
      // строительство я узнаю разведкой, а не уведомлением.
      // Что говорит каждое из трёх событий стройки — `buildLog.ts` (REFM-175): «улучшено»
      // называет УРОВЕНЬ, якорь на мир несёт только РАЗРУШЕНИЕ (взрыв — происшествие, к
      // которому игрок прыгнет камерой), а зенитки включает только готовая крепость.
      // Гейт `admits('<тип>')` намеренно стоит В КАЖДОМ case отдельной строкой: его
      // сторожит опись в `recapGate.test.ts`, и общий `admits(e.type, …)` её обходит.
      case 'building.constructed':
        if (!admits('building.constructed', p)) break;
        game.tellBuild('constructed', p);
        game.noticeFlash(s.planets[p.planetId as string]?.position); // UIX-4.1: малая вспышка
        break;
      case 'building.upgraded':
        if (!admits('building.upgraded', p)) break;
        game.tellBuild('upgraded', p);
        game.noticeFlash(s.planets[p.planetId as string]?.position);
        break;
      // Разрушение — исключение по туману: своё узнаю всегда, чужое лишь там, где ВИЖУ
      // (тот же фог-гейт, что у `aa.fired`). Взрыв на наблюдаемом мире — наблюдение, а
      // не раскрытие.
      case 'building.destroyed':
        if (!admits('building.destroyed', p)) break;
        game.tellBuild(p.cleared === true ? 'cleared' : 'destroyed', p);
        break;
      case 'unit.built':
        if (!admits('unit.built', p)) break;
        note(
          `🛠️ ${p.count}× ${displayUnit(p.unit as string)} · ${game.placeName(p.planetId as string)}`,
        );
        break;
      case 'army.load.cancelled':
        // AUDM-4: вылет снял идущую погрузку. Своё — чужая погрузка это разведданные.
        if (!admits('army.load.cancelled', p)) break;
        note(
          t('log.army.load-cancelled', {
            n: String(p.count),
            u: displayUnit(p.unit as string),
            at: game.placeName(p.planetId as string),
          }),
          p.planetId as string,
        );
        break;
      case 'army.unload.cancelled':
        // AUDM-4 и для выгрузки (MSB-9): вылет снял идущую выгрузку, десант остался на борту.
        if (!admits('army.unload.cancelled', p)) break;
        note(
          t('log.army.unload-cancelled', {
            n: String(p.count),
            u: displayUnit(p.unit as string),
            at: game.placeName(p.planetId as string),
          }),
          p.planetId as string,
        );
        break;
      case 'assault.landing':
        // MSB-9: высадка идёт полтора часа, и прилёт врага её срывает — защитнику нужно
        // узнать о ней сразу, иначе ответить нечем. Видна всем, кто видит мир.
        if (!admits('assault.landing', p)) break;
        note(
          t('log.assault.landing', {
            at: game.placeName(p.planetId as string),
            t: timeLeft(p.doneAt as number),
          }),
          p.planetId as string,
        );
        break;
      case 'assault.interrupted':
        if (!admits('assault.interrupted', p)) break;
        note(
          t('log.assault.interrupted', { at: game.placeName(p.planetId as string) }),
          p.planetId as string,
        );
        break;
      // UIX-4.1: свой флот дошёл — малая вспышка на месте (скилл `mobile-game-feel`). Стоянка
      // в точке дороги (`fleet.parked`) — тот же приход, только не в мир. Чужой приход —
      // не моя новость: его видно по самому флоту.
      case 'fleet.arrived':
      case 'fleet.parked': {
        const fleet = s.fleets[p.fleetId as string];
        if (fleet?.owner === ME) game.noticeFlash(fleetPos(fleet));
        break;
      }
      case 'fleet.launched':
        // Вылет — событие КАРТЫ: чужой флот, поднявшийся на мире, который я вижу,
        // это наблюдение. Но за туманом его быть не должно (как у `aa.fired`).
        if (!admits('fleet.launched', p)) break;
        note(
          t('log.fleet.launched', {
            who: NAME[p.owner as string] ?? (p.owner as string),
            at: game.placeName(p.planetId as string),
          }),
        );
        break;
      case 'aa.fired': {
        const planet = s.planets[p.planetId as string];
        if (!planet || !known(p.planetId as string)) break; // fogged flak stays unseen
        // Концы дуги и предел очереди — `fireEffects.ts` (REFM-178): жертва могла погибнуть
        // ЭТИМ же залпом (ядро издаёт событие после урона), и тогда вспышка встаёт над
        // своей орбитой — беззвучно пропавший залп читался бы как «ПКО не сработало».
        const target = s.fleets[p.fleetId as string];
        game.shot({
          from: { ...planet.position },
          to: aaImpact(target && fleetPos(target), planet.position),
          at: performance.now(),
          tier: flakTier(p.tier === 'close'),
        });
        break;
      }
      // ВСТРЕЧНЫЙ ПЕРЕХВАТ (SHU-1.3) — база подняла дежурное звено навстречу чужому
      // вылету. На карте это ТРЕТИЙ тир огня (`flakTiers.ts`), а не зенитка: спутав их,
      // игрок решит, что его прикрывает пушка, тогда как тратится топливо порта.
      // Концы берутся СЕЙЧАС (правило 1 `fireEffects.ts`): вылет мог быть сбит этим же
      // подъёмом, и тогда вспышка встаёт над орбитой самой базы — молча пропавший
      // перехват читался бы как «звено не взлетело».
      case 'shuttle.intercepted': {
        const base = { kind: p.baseKind, id: p.baseId } as StrikeBase;
        // Перехват ИЗ ПАТРУЛЯ (SHU-6.3) бьёт из круга, а не с базы: `patrolId` — вылет,
        // который стрелял, и залп выходит из его точки. Иначе — с базы, как подъём звена.
        const patrol = typeof p.patrolId === 'string' ? strikeWorldPos(p.patrolId) : null;
        const home = patrol ?? strikeBasePos(base); // одна функция на «где база» — и здесь, и у трассы
        if (!home) break;
        const carrier = base.kind === 'fleet' ? s.fleets[base.id] : undefined;
        const node = base.kind === 'planet' ? base.id : carrier ? fleetNode(carrier) : null;
        if (!seen(isMine([p.owner as string, p.targetOwner as string], ME), known(node))) break;
        game.shot({
          from: { ...home },
          to: aaImpact(strikeWorldPos(p.strikeId as string), home),
          at: performance.now(),
          tier: 'intercept',
        });
        break;
      }
      // КОРАБЕЛЬНОЕ ПВО (AUD-17) — четвёртый тир огня (`flakTiers.ts`, правило 6). Ядро
      // давно издавало `pd.fired`, но его никто не слушал: зенитка МИРА рисовалась, а
      // эскорт стрелял невидимо, и сбитые им машины исчезали будто сами. Концы и гейт —
      // как у перехвата: старт у корабля, удар по вылету СЕЙЧАС (правило 1
      // `fireEffects.ts` — вылет мог погибнуть этим же залпом, и тогда вспышка встаёт над
      // самим кораблём), видно своё и чужое на опознанном узле.
      case 'pd.fired': {
        const ship = s.fleets[p.fleetId as string];
        const from = ship ? fleetPos(ship) : null;
        if (!ship || !from) break;
        if (!seen(isMine([p.owner as string, p.targetOwner as string], ME), fleetKnown(ship)))
          break;
        game.shot({
          from: { ...from },
          to: aaImpact(strikeWorldPos(p.strikeId as string), from),
          at: performance.now(),
          tier: 'pointDefense',
        });
        break;
      }
      // УДАР ШАТТЛОВ ПО ЦЕЛИ (SHU-6.11, `decisions/shuttleHit.ts`) — и налёт по прибытии, и
      // каждый тик патруля. Пятый тир огня (`flakTiers.ts`, правило 7): трасса из видимого
      // источника и вспышка у цели. Концы — СЕЙЧАС, как у зениток (правило 1
      // `fireEffects.ts`): добитый этим ударом флот из мира уже ушёл, и вспышка встаёт над
      // узлом, где он стоял. Жертве — строка в журнале, одна на налёт по цели.
      case 'shuttle.hit': {
        const hit = {
          strikeId: p.strikeId as string,
          owner: p.owner as string,
          targetId: p.targetId as string,
          targetOwner: p.targetOwner as string | null | undefined,
        };
        const planet = s.planets[hit.targetId];
        const fleet = planet ? undefined : s.fleets[hit.targetId];
        const node = planet
          ? hit.targetId
          : fleet
            ? fleetNode(fleet)
            : (p.location as string) || null;
        const targetKnown = planet ? known(hit.targetId) : fleet ? fleetKnown(fleet) : known(node);
        const view = shuttleHitView(hit, ME, targetKnown, announcedHits);
        if (!view.show) break;
        // Флот — в его значок на орбите, а не в центр мира: удар пришёлся по кораблям.
        const anchor = fleet ? fleetAnchor(fleet) : null;
        const to = planet
          ? planet.position
          : anchor
            ? unworld(anchor)
            : node
              ? s.planets[node]?.position
              : null;
        if (to) {
          // Свой вылет — из его точки, чужой — только из патруля, который я вижу (правило 3).
          const from =
            hit.owner === ME
              ? strikeWorldPos(hit.strikeId)
              : seenPatrolOver(vision?.seenPatrols ?? [], hit.owner, to);
          game.shot({
            from: { ...(from ?? to) },
            to: { ...to },
            at: performance.now(),
            tier: 'strike',
          });
        }
        if (view.journal) {
          announcedHits.add(hitKey(hit));
          note(
            t('log.shuttle.hit', {
              what: planet ? game.placeName(hit.targetId) : game.fleetTitleOf(hit.targetId),
            }),
            node ?? undefined,
          );
        }
        break;
      }
      // ROS-2.2 — ответка по челнокам в момент удара. Две точки зрения на одно
      // событие, и обе нужны: свои машины сбили — это счёт за налёт, свои зенитки
      // отработали — это то, ради чего их и строили. Чужую ответку по чужим челнокам
      // журнал не показывает: она не про меня.
      case 'shuttle.repelled': {
        const mine = p.owner === ME;
        if (!mine && p.targetOwner !== ME) break;
        if ((p.downed as number) <= 0) break; // залп был, машин не сбил — строка ни о чём
        note(
          t(mine ? 'log.shuttle.repelled.mine' : 'log.shuttle.repelled.theirs', {
            n: p.downed as number,
            at: game.placeName(p.targetId as string),
          }),
        );
        break;
      }
      // Ракету сбили челноки (SM-3.7b): одна строка обеим сторонам, как у перехвата ПРО.
      // `fleet.destroyed` следом помечен `spent` — «флот уничтожен» о ней не пишется.
      case 'shuttle.missileDowned':
        if (p.owner === ME || p.playerId === ME) note(t('log.shuttle.missile-downed'));
        break;
      // «Держать патруль» снят ядром (SHU-6.6): помеха сама не пройдёт — эскадра больше не
      // висит, точка за радиусом. Без строки игрок ждал бы патруль над базой, который уже
      // не встанет, и не знал бы почему.
      case 'shuttle.hold.ended':
        if (p.owner !== ME) break;
        note(
          t('log.shuttle.hold-ended', {
            name: squadronCallsignOf(p.squadronId as string),
            why: errText(p.code as string),
          }),
          p.baseKind === 'planet' ? (p.baseId as string) : undefined,
        );
        break;
      case 'market.bought':
        // Сделка слышна обеим сторонам, и сторона выбирает СЛОВО, а не знак числа —
        // `fleetNews.ts` (REFM-181): «купил» и «продал» это разные события в голове.
        if (tradeHeard(p.buyer, p.seller, ME))
          note(
            t('log.market.trade', {
              n: String(p.amount),
              res: TECH_CUR[p.resource as string] ?? tData(p.resource as string),
              paid: String(p.paid ?? '?'),
              side: t(tradeSide(p.buyer, ME)),
            }),
          );
        break;
      case 'fleet.merged':
        if (reorgHeard(p.owner, ME))
          note(t(reorgKey('merged'), { at: game.placeName(p.at as string) }));
        break;
      case 'fleet.split':
        // Чужую реорганизацию наблюдать нечем — на карте виден значок, а не то, что
        // два соединения свели в одно (`fleetNews.ts`, правило 2). В пути места нет.
        if (reorgHeard(p.owner, ME))
          note(
            typeof p.at === 'string'
              ? t(reorgKey('split'), { at: game.placeName(p.at) })
              : t('log.fleet.split-transit'),
          );
        {
          const pick = splitSelectTarget(game.splitAwait(), p, ME);
          if (pick) {
            game.endSplitAwait();
            game.setFleetSelection([pick]);
          }
        }
        break;
      // AUD-16: герой больше не гибнет молча. Только свой — в сети геройские события и
      // так строго адресны владельцу, соло повторяет тот же фильтр (`heroNews.ts`).
      case 'hero.died':
        game.tellHero(
          heroDiedNews(p, s.heroes?.[p.heroId as string], ME, s.time, (id) => !!s.planets[id]),
        );
        break;
      case 'hero.respawned':
        game.tellHero(heroRespawnedNews(p, ME, (id) => !!s.planets[id]));
        break;
      // PVR-4.7: босс — часть штурма, и забег объявляет его, как объявляет волны. Имя —
      // ключом по архетипу: у каждой фразы свой падеж, подстановкой его не собрать.
      case 'pve.boss.spawned':
      case 'pve.boss.slain':
        note(t(`boss.${p.hero as string}.${e.type === 'pve.boss.spawned' ? 'spawned' : 'slain'}`));
        break;
      // Глава IV (PVR-7.5): встреча с союзником — связь, общий обзор и приказы. Чип «⬡
      // Союзник» мигает несколько секунд: сама встреча и есть приглашение открыть связь.
      case 'ally.contact':
        if (p.owner !== ME) break;
        note(t('ally.contact.note'));
        game.pulseAlly();
        break;
      // Глава VI (PVR-8.4, §8.4): доки найдены — своим зрением или зрением союзника. Живой
      // сигнал общины; адресат — тот, кто получил сведения (`owner`).
      case 'refuge.found':
        if (p.owner === ME) note(t('refuge.signal'), p.at as string);
        break;
      case 'ally.order.done':
      case 'ally.order.lost':
        if (p.by !== ME) break;
        note(t(e.type === 'ally.order.done' ? 'ally.done' : 'ally.lost'));
        break;
      case 'extraction.completed':
        if (p.owner === ME) note(t('chain.carrier-warning'));
        break;
      // Глава V (PVR-9.5): пленный взят или потерян. Доставку объявляет страница комикса.
      case 'captive.taken':
        note(t(p.by === ME ? 'captive.taken.note' : 'captive.taken.ally'));
        break;
      case 'captive.lost':
        note(t('captive.lost.note'));
        break;
      // PVR-4.7: осада «Поглощения мира» над СВОИМ миром — начало, срыв и гибель мира. Фраза —
      // по архетипу героя, как у появления босса; отсчёт — тем же часам, что у волн.
      case 'hero.siege.started':
      case 'hero.siege.broken':
      case 'hero.siege.done': {
        if (p.victim !== ME) break;
        const arch = s.heroes?.[p.heroId as string]?.archetype;
        if (!arch) break;
        const phrase =
          e.type === 'hero.siege.started'
            ? 'siege'
            : e.type === 'hero.siege.done'
              ? 'devoured'
              : 'siege-broken';
        const world = game.placeName(p.target as string);
        note(
          t(`boss.${arch}.${phrase}`, { world, in: countdownHMS((p.until as number) - s.time) }),
        );
        break;
      }
      case 'fleet.destroyed':
        // Слышит только владелец флота, как в сети (`fleetNews.ts`, правило 4, решение
        // владельца 2026-10-06): чужая гибель — раскрытие информации.
        if (destroyHeard(p, ME))
          note(t('log.fleet.destroyed', { who: NAME[p.owner as string] ?? (p.owner as string) }));
        break;
      // Тёмное событие (`data/events.json`). Гейт СВОЙ, а не общий `admits()`: тот читает
      // `p.owner`, а здесь адресат приезжает как `playerId` — чужая аномалия прошла бы
      // мимо проверки и утекла бы ко мне в журнал вместе с чужой экономикой.
      // Подстановки берутся из `params` правила: карта `resources` даёт по ключу на
      // ресурс (`{metal}`), одиночная пара — `{n}`. Знак несёт сама строка локали, поэтому
      // в подстановку едет модуль: «сожгла 60 энергии», а не «сожгла −60».
      case 'effect.applied': {
        if (p.playerId !== ME) break;
        const params = data.events[p.ruleId as string]?.params ?? {};
        const bundle = params['resources'];
        const amount = params['amount'];
        const vars =
          typeof bundle === 'object' && bundle !== null && !Array.isArray(bundle)
            ? Object.fromEntries(
                Object.entries(bundle).map(([res, v]) => [res, Math.abs(Number(v) || 0)]),
              )
            : { n: Math.abs(Number(amount) || 0) };
        note(
          t(`event.${(p.ruleId as string).replace(/_/g, '-')}`, vars),
          p.planetId as string | undefined,
        );
        break;
      }
      // EVT-2: трофеи с поля боя. Гейт тот же, что у тёмного события, и по той же
      // причине: адресат приезжает как `playerId`, а чужая добыча — чужая экономика.
      // Мешок печатается значками (`costText`), а не прозой: склонять «20 металла /
      // 4 кредита» пришлось бы в коде, а ресурсы задаются данными и список открыт.
      case 'salvage.paid': {
        if (p.playerId !== ME) break;
        const bag = p.resources as Record<string, number> | undefined;
        if (!bag || Object.keys(bag).length === 0) break;
        note(t('log.salvage', { what: costText(bag) }), p.location as string | undefined);
        break;
      }
      // SM-3.5: мины сработали. Жертва и хозяин поля видят сообщение и вспышку на узле;
      // остальным поле неизвестно, и срабатывание тоже.
      case 'mines.triggered': {
        const at = p.at as string;
        const victim = p.owner === ME;
        if (!victim && !(p.by as string[] | undefined)?.includes(ME)) break;
        note(t(victim ? 'log.mines.hit' : 'log.mines.triggered', { n: Number(p.lost) || 0 }), at);
        game.mineFlash(at, p.position as { x: number; y: number } | undefined);
        break;
      }
      case 'unit.died': {
        // Счёт и ведомость наполняются по РАЗНЫМ условиям — `warTally.ts` (REFM-180):
        // счёт это личная статистика (только мои бои), ведомость питает строку ленты,
        // а чужой бой на опознанном узле игрок видит и о цене исхода читает.
        const at = p.at as string;
        if (myBattleLocs.has(at)) killStats = tallyDeath(killStats, p.owner, ME, p.count);
        // Бой блока зрения на неопознанном узле — и мгновенный — платит ведомость той же
        // видимостью, что его начало и итог, иначе строка итога выходит без потерь
        // (замечание Codex на #1418).
        const lossSeen = battleEngaged(p.battleId) || flashSeen(p.battleId);
        if (seenTail(myBattleLocs.has(at), known(at) || lossSeen)) {
          battleLosses.set(
            at,
            recordLoss(battleLosses.get(at), p.owner, p.unit as string, p.count),
          );
        }
        break;
      }
    }
  }
}

// Walk-in capture (undefended, uncontested, capturable sector) is now a kernel
// rule — `captureOnArrivalModule` — so it applies on the authoritative server and
// in single-player alike; the resulting `planet.captured` event is noted above.

/** Смена матча: журнал, сводка возвращения, счёт войны и память боёв принадлежат СТАРОМУ
 *  матчу. Защита от повторов не сбрасывается: она мерит реальное время, а не матч. */
export function resetEventFeed(): void {
  killStats = { destroyed: 0, lost: 0 };
  myBattleLocs.clear();
  engagedBattleIds.clear(); // id боёв (`battle:0`…) повторяются от матча к матчу (замечание Codex на #1417)
  battleLosses.clear();
  logLines.length = 0; // fresh log — drop notes from the menu-background match
  eventLog.length = 0; // ONB-5: the return digest belongs to THIS match only
}
