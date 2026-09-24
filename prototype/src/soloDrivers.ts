/**
 * Соло-драйверы: что клиент делает ЗА мир, пока сервер не играет (REFM-26).
 *
 * В сетевом матче всё это делает сервер — он владеет часами, боем и каждым соперником.
 * В одиночном матче некому, поэтому кадр прототипа сам подталкивает мир: ходы ИИ,
 * авто-штурм, столкновения флотов, дежурные вылеты и цепочки приказов.
 *
 * Здесь ПОЛИТИКА клиента, а не правила игры. Разница важная и однажды уже стоила
 * дорого (RULES-1): правила — «захватываема ли провинция», «есть ли десант», «что
 * говорит дипломатия» — называет ядро, и переписывать их здесь руками нельзя, иначе
 * рукописная копия разъезжается с редьюсером и сыплет отказами каждый кадр. Клиент
 * решает лишь то, чего ядро не знает: пускать ли автоматику на СВОЙ флот, дать ли бою
 * утихнуть, как часто ходит ИИ.
 *
 * Форма REFM: `initSoloDrivers(host)`. Приказы уходят двумя разными путями — свой через
 * `playerOrder` (в сети он ушёл бы на сервер), чужой применяется локально, — поэтому
 * хозяин отдаёт оба, и драйверы проверяются на настоящем состоянии без DOM.
 */
import type { Action, Fleet, GameState } from '../../packages/shared-core/src/index';
import { autoRetreatDue, beaconSentinels } from '../../packages/shared-core/src/index';
import type { AiProfile } from './ai';
import type { StewardPosture } from './stewardScreen';
import { StaggeredAi } from './aiScheduler';
import { aiOrderSlices } from './aiOrderSlices';
import {
  aiOrders,
  assaultFleet,
  canOrder,
  chainStamp,
  data,
  engageFleet,
  HOUR,
  order,
  orbitFleet,
  retreatFleet,
  serverChainActions,
  stewardActive,
  strikeShuttle,
} from './game';
import { patrolScrambles } from '../../packages/shared-core/src/index';

/** Как часто ходит локальный ИИ (игровое время). Чаще — только лишние прогоны. */
export const AI_STEP_MS = 2 * HOUR;

/**
 * Ключ памяти проб авто-штурма: «этот флот в этом часе мира, на этой орбите, над
 * миром этого владельца». Проба стоит прогона редьюсера, а цикл гоняется каждый кадр,
 * поэтому обречённую пару «орбита → штурм» запоминаем и не пережимаем; сменился час,
 * орбита или владелец мира — ключ другой, и попытка повторится.
 */
export function autoProbeKey(f: Fleet, now: number, hereOwner: string | null): string {
  return `${now}|${f.orbit ?? ''}|${f.location ?? ''}|${hereOwner ?? ''}`;
}

/** Что драйверы берут у клиента. Состоянием и путями приказов они не владеют. */
export interface SoloHost {
  state(): GameState;
  me(): string;
  /** Места, которые ведёт локальный ИИ (пустые кресла), и КАКОЙ силы бот на каждом
   *  (AIDIFF-1). Сложность едет вместе с местом, а не отдельной настройкой хоста: в
   *  одном матче соперники могут быть разными, и «сильный» — свойство кресла. */
  aiSeats(): ReadonlyMap<string, AiProfile>;
  /** Приказ ЧУЖОГО места: применяется прямо здесь. */
  applyLocal(a: Action): void;
  /** СВОЙ приказ: общий путь клиента (в сети он уходит на сервер). */
  playerOrder(a: Action): void;
  /** Опт-ин авто-штурма для своего флота (CC-2). Чужие штурмуют всегда. */
  autoAssault(fleetId: string): boolean;
  /** Дежурные вылеты (CC-4): живая карта клиента — драйвер её же и чистит. */
  patrols(): Map<string, { kind: 'planet' | 'fleet' }>;
  /** Опознан ли узел (цель дежурного вылета обязана быть видимой). */
  known(loc: string): boolean;
}

export interface SoloDrivers {
  /** Ход ИИ за кадр: одно планирование и порции построенного плана (зависимая пара
   *  приказов одной сущности — всегда в одной порции). */
  runAI(): void;
  /** Авто-штурм: чужие флоты давят цикл захвата, свои — только с опт-ином. */
  autoEngage(): void;
  /** Страховка: два простаивающих врага в одном секторе без боя — свести их. */
  checkFleetClashes(): void;
  /** CC-1: продвинуть цепочки приказов и выдать шаг головы. */
  driveChains(): void;
  /** CC-4: дежурные вылеты — перезарядка по часам и удар по опознанной цели. */
  drivePatrols(): void;
  /** RETR-2: авто-отступление — увести флоты, чей корпус просел до порога приказа. */
  driveAutoRetreat(): void;
  /** Первый вставший дежурный вылет: считать перезарядку ОТСЮДА, а не от эпохи —
   *  иначе крыло получило бы разом все часы, что матч шёл до него. */
  /** Новый матч: часы ИИ и память проб начинаются заново. */
  reset(): void;
}

export function initSoloDrivers(host: SoloHost): SoloDrivers {
  /** Обречённые пары «орбита → штурм»: id флота → ключ состояния. */
  const probed = new Map<string, string>();
  const ai = new StaggeredAi<Action[]>(AI_STEP_MS);

  /** Свой приказ идёт своим путём, чужой — локально: в сети первый уходит на сервер. */
  const issue = (owner: string, a: Action): void => {
    if (owner === host.me()) host.playerOrder(a);
    else host.applyLocal(a);
  };

  /** Потолок порций за кадр. Не потеря: недовыбранные порции остаются в планировщике
   *  и уходят следующим кадром — потолок только не даёт патологически большому плану
   *  собраться в один кадр. */
  const AI_SLICES_PER_FRAME = 32;

  function runAI(): void {
    const current = host.state();
    if (current.match.status === 'ended') return;
    const policyFor = (seat: string): string | null => {
      if (host.state().players[seat]?.status !== 'active') return null;
      const profile = host.aiSeats().get(seat);
      if (profile) return `expand:${profile}`;
      const posture =
        seat === host.me() ? stewardActive(host.state(), seat, host.state().time) : null;
      return posture ? `steward:${posture}` : null;
    };
    // Поза берётся из ТОЙ ЖЕ политики, по которой планировщик гейтит план, а не
    // выводится заново: `expand:<профиль>` → 'expand', `steward:<поза>` → поза. Иначе
    // план строится под одну позу, а проверка на устаревание идёт по другой.
    const planFor = (seat: string, policy: string): Action[][] => {
      const profile = host.aiSeats().get(seat);
      const posture = policy.startsWith('steward:') ? policy.slice('steward:'.length) : 'expand';
      return aiOrderSlices(
        aiOrders(host.state(), seat, posture as StewardPosture | 'expand', profile ?? 'weak'),
      );
    };
    // Планирование за кадр — ОДНО (оно и стоит дорого, ~2 мс), а порции построенного
    // плана выбираются в том же кадре. Раньше выдавалась одна порция за кадр, и план,
    // не выбранный за свой период, просрочивался: сила соперника начинала зависеть от
    // частоты кадров телефона — против правила строкой выше в `main.ts` («при просадке
    // FPS мир идёт с той же быстротой»). Семантика просрочки не тронута: она защищает
    // от приказов, построенных под устаревший мир, — здесь лишь не даём ей срабатывать
    // из-за медленного устройства.
    let planned = false;
    for (let slices = 0; slices < AI_SLICES_PER_FRAME; ) {
      const step = ai.step(current.time, Object.keys(current.players), policyFor, planFor);
      if (!step.worked) break;
      if (!step.action) {
        if (planned) break; // это уже следующее место — его план построим в следующем кадре
        planned = true;
        continue;
      }
      for (const action of step.action) host.applyLocal(action);
      slices += 1;
    }
  }

  function autoEngage(): void {
    const s = host.state();
    // Дозорный Роя на маяке задачи (`beaconSentinels`) не захватывает провинцию: иначе
    // маяк становился бы миром Роя, и волны рождались бы у маяка, а не в улье.
    const sentinels = s.pve ? beaconSentinels(s, s.pve.npcPlayerId) : new Set<string>();
    for (const f of Object.values(s.fleets)) {
      if (f.location == null || f.movement || f.battleId) continue;
      if (sentinels.has(f.id)) continue;
      const mine = f.owner === host.me();
      // Чужие всегда давят цикл захвата; свой флот — только если игрок сам включил
      // авто-штурм (CC-2), иначе штурмами он распоряжается руками.
      if (mine && !host.autoAssault(f.id)) continue;
      const here = s.planets[f.location];
      if (!here || here.owner === f.owner) continue; // свой мир штурмовать нечего
      const enemyHere = Object.values(s.fleets).some(
        (g) => g.owner !== f.owner && g.location === f.location && g.units.some((u) => u.count > 0),
      );
      if (enemyHere) continue; // ПОЛИТИКА клиента: дать орбитальному бою утихнуть
      // RULES-1. Выше — только политика; ПРАВИЛА (захватываемая провинция, дипломатия,
      // наличие десанта) называет ядро. Проверяется вся ПАРА «низкая орбита → штурм»:
      // штурм нелегален с дальней орбиты, поэтому проба идёт по состоянию ПОСЛЕ
      // орбиты (черновик — живой мир не трогается). Иначе применилась бы половина
      // обречённой пары: орбита проходит, штурм отбивается.
      const key = autoProbeKey(f, s.time, here.owner);
      if (probed.get(f.id) === key) continue;
      const needOrbit = f.orbit !== 'near';
      const step = needOrbit ? order(s, orbitFleet(f.owner, f.id, 'near'), s.time) : null;
      if (step?.error) continue;
      const probe = step ? step.state : s;
      if (canOrder(probe, assaultFleet(f.owner, f.id)) !== null) {
        probed.set(f.id, key); // обречён в этом часе мира — не пережимать каждый кадр
        continue;
      }
      if (needOrbit) issue(f.owner, orbitFleet(f.owner, f.id, 'near'));
      issue(f.owner, assaultFleet(f.owner, f.id));
    }
  }

  /**
   * Страховка на случай, когда оба флота были в пути и обработчик прибытия боевого
   * модуля не нашёл противника: два простаивающих врага в одном секторе без боя —
   * свести их принудительно.
   */
  function checkFleetClashes(): void {
    const s = host.state();
    const me = host.me();
    const fleets = Object.values(s.fleets);
    for (const f of fleets) {
      if (!f.location || f.movement || f.battleId) continue;
      for (const g of fleets) {
        if (g.id <= f.id) continue; // пара обрабатывается один раз
        if (!g.location || g.movement || g.battleId) continue;
        if (f.owner === g.owner || f.location !== g.location) continue;
        // Бой начинается со стороны игрока, если он в паре есть.
        const myFleet = f.owner === me ? f : g.owner === me ? g : f;
        const foeFleet = myFleet === f ? g : f;
        host.applyLocal(engageFleet(myFleet.owner, myFleet.id, foeFleet.id));
      }
    }
  }

  /** CC-1: то же чистое ядро, что гоняет сетевой сервер — проштамповать цепочку
   *  вперёд (списание при выдаче), затем выдать приказы шага головы. */
  function driveChains(): void {
    const s = host.state();
    for (const c of serverChainActions(s, s.time)) {
      if (c.patch) issue(c.owner, chainStamp(c.owner, c.fleetId, c.patch.steps, c.patch.waitUntil));
      for (const a of c.actions) issue(c.owner, a);
    }
  }
  /**
   * CC-4: дежурная БАЗА (мир с портом или носитель) сама поднимает эскадру навстречу
   * ближайшему опознанному врагу в её радиусе (SHU-2.2 — раньше дежурил флот челноков).
   *
   * Решение целиком в ядре (`patrolScrambles`): и выбор цели, и чтение мира. Здесь
   * остаётся отдать приказ. Ни топлива, ни перезарядки драйвер больше не ведёт — они
   * принадлежат базе и тратятся самим `shuttle.strike`.
   */
  function drivePatrols(): void {
    const patrols = host.patrols();
    if (patrols.size === 0) return;
    const s = host.state();
    // Соло держит дежурства в локальной карте — ядру их надо предъявить в его форме.
    const view = { ...s, patrols: Object.fromEntries(patrols) };
    for (const sc of patrolScrambles(view, data)) {
      if (sc.owner !== host.me()) continue;
      host.playerOrder(
        strikeShuttle(
          sc.owner,
          sc.base.kind === 'planet' ? { planetId: sc.base.id } : { fleetId: sc.base.id },
          sc.squadronId,
          { targetFleetId: sc.targetFleetId },
        ),
      );
    }
  }

  /**
   * RETR-2 — авто-отступление в СОЛО. Кого уводить, решает ядро (`autoRetreatDue`:
   * приказ стоит, флот в бою, корпус просел до порога); здесь только выдача приказа
   * своим путём для своего места и локально для мест под ИИ. Тот же ответ ядра
   * читает сетевой хост (`serverAutoRetreatActions`) — правило одно на оба режима.
   */
  function driveAutoRetreat(): void {
    const current = host.state();
    if (current.match.status === 'ended') return;
    for (const { fleetId, owner, to } of autoRetreatDue(current, data)) {
      issue(owner, retreatFleet(owner, fleetId, to));
    }
  }

  return {
    runAI,
    autoEngage,
    checkFleetClashes,
    driveChains,
    drivePatrols,
    driveAutoRetreat,
    reset: () => {
      ai.reset(host.state().time);
      probed.clear();
    },
  };
}
