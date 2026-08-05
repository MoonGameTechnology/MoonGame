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
import { getStance } from '../../packages/shared-core/src/index';
import {
  aiOrders,
  assaultFleet,
  canOrder,
  chainStamp,
  engageFleet,
  fleetHasSquadron,
  fleetIdle,
  HOUR,
  order,
  orbitFleet,
  scrambleOrder,
  serverChainActions,
  sortieSpec,
  stewardActive,
  tickRearm,
  type Patrol,
} from './game';

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
  /** Места, которые ведёт локальный ИИ (пустые кресла). */
  aiSeats(): ReadonlySet<string>;
  /** Приказ ЧУЖОГО места: применяется прямо здесь. */
  applyLocal(a: Action): void;
  /** СВОЙ приказ: общий путь клиента (в сети он уходит на сервер). */
  playerOrder(a: Action): void;
  /** Опт-ин авто-штурма для своего флота (CC-2). Чужие штурмуют всегда. */
  autoAssault(fleetId: string): boolean;
  /** Дежурные вылеты (CC-4): живая карта клиента — драйвер её же и чистит. */
  patrols(): Map<string, Patrol>;
  /** Опознан ли узел (цель дежурного вылета обязана быть видимой). */
  known(loc: string): boolean;
}

export interface SoloDrivers {
  /** Ходы ИИ за пустые кресла (и за ваше, пока оно делегировано «Хранителю»). */
  runAI(): void;
  /** Авто-штурм: чужие флоты давят цикл захвата, свои — только с опт-ином. */
  autoEngage(): void;
  /** Страховка: два простаивающих врага в одном секторе без боя — свести их. */
  checkFleetClashes(): void;
  /** CC-1: продвинуть цепочки приказов и выдать шаг головы. */
  driveChains(): void;
  /** CC-4: дежурные вылеты — перезарядка по часам и удар по опознанной цели. */
  drivePatrols(): void;
  /** Первый вставший дежурный вылет: считать перезарядку ОТСЮДА, а не от эпохи —
   *  иначе крыло получило бы разом все часы, что матч шёл до него. */
  startPatrolCadence(): void;
  /** Новый матч: часы ИИ и память проб начинаются заново. */
  reset(): void;
}

export function initSoloDrivers(host: SoloHost): SoloDrivers {
  /** Обречённые пары «орбита → штурм»: id флота → ключ состояния. */
  const probed = new Map<string, string>();
  let lastAiAt = 0;
  let lastPatrolTick = 0;

  /** Свой приказ идёт своим путём, чужой — локально: в сети первый уходит на сервер. */
  const issue = (owner: string, a: Action): void => {
    if (owner === host.me()) host.playerOrder(a);
    else host.applyLocal(a);
  };

  function runAI(): void {
    const s = host.state();
    if (s.time - lastAiAt < AI_STEP_MS) return;
    lastAiAt = s.time;
    // Приказы каждого пустого кресла берутся из общего `aiOrders` — той же логики,
    // которой сетевой сервер ведёт незанятые места.
    for (const ai of host.aiSeats()) {
      for (const a of aiOrders(host.state(), ai)) host.applyLocal(a);
    }
    // «Хранитель»: пока ваше место делегировано, локальный ИИ играет и его — на его
    // осанке (оборона), чтобы делегирование в соло реально держало линию, а не
    // показывало таймер.
    const me = host.me();
    const posture = stewardActive(host.state(), me, host.state().time);
    if (posture && !host.aiSeats().has(me)) {
      for (const a of aiOrders(host.state(), me, posture)) host.applyLocal(a);
    }
  }

  function autoEngage(): void {
    const s = host.state();
    for (const f of Object.values(s.fleets)) {
      if (f.location == null || f.movement || f.battleId) continue;
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
   * CC-4: крыло на дежурном вылете, если оно простаивает, бьёт по опознанному контакту
   * в радиусе удара — тратя одно топливо (SQ-2.1) — и перезаряжает один раунд за
   * прошедший игровой час. Само решение (`scrambleOrder`) чистое и покрыто своим
   * тестом; здесь только чтение мира: видимость и дипломатия.
   */
  function drivePatrols(): void {
    const patrols = host.patrols();
    if (patrols.size === 0) return;
    const s = host.state();
    const me = host.me();
    const rounds = Math.max(0, Math.floor((s.time - lastPatrolTick) / HOUR));
    if (rounds > 0) lastPatrolTick += rounds * HOUR;
    for (const [fid, p] of [...patrols]) {
      const f = s.fleets[fid];
      if (!f || f.owner !== me || !fleetHasSquadron(f)) {
        patrols.delete(fid);
        continue;
      }
      const spec = sortieSpec(f);
      for (let i = 0; i < rounds && p.sortie.rearming > 0; i++)
        p.sortie = tickRearm(p.sortie, spec.maxFuel);
      if (!fleetIdle(f)) continue; // занят (перелёт / бой) — сперва пусть разрешится
      // Враждебные ОПОЗНАННЫЕ контакты, стоящие на узле, — законные цели крыла.
      const targets: Array<{ id: string; location: string; pos: { x: number; y: number } }> = [];
      for (const g of Object.values(s.fleets)) {
        if (g.owner === me || !g.location || g.movement || !g.units.some((u) => u.count > 0))
          continue;
        if (g.battleId) continue; // в бою — engage отвергнут, а топливо вылета уже потрачено (BF-30)
        if (getStance(s, me, g.owner) !== 'war') continue; // только объявленная война — авто-войны нет
        if (!host.known(g.location)) continue; // «опознанная цель в зоне видимости»
        const pos = s.planets[g.location]?.position;
        if (pos) targets.push({ id: g.id, location: g.location, pos });
      }
      const { action, sortie } = scrambleOrder(me, f, p, targets, spec.rearmRounds);
      p.sortie = sortie;
      if (action) host.playerOrder(action);
    }
  }

  return {
    runAI,
    autoEngage,
    checkFleetClashes,
    driveChains,
    drivePatrols,
    startPatrolCadence: () => {
      lastPatrolTick = host.state().time;
    },
    reset: () => {
      lastAiAt = host.state().time;
      probed.clear();
    },
  };
}
