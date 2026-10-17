/**
 * Соло-драйверы: что клиент делает ЗА мир, пока сервер не играет (REFM-26).
 *
 * В сетевом матче всё это делает сервер — он владеет часами, боем и каждым соперником.
 * В одиночном матче некому, поэтому кадр прототипа сам подталкивает мир: ходы ИИ,
 * авто-штурм, столкновения флотов, авто-отступление и цепочки приказов. Удерживаемый
 * патруль шаттлов (SHU-6.6) в этот список не входит: его поднимает событие ядра.
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
import { autoRetreatDue, beaconSentinels, getStance, isMineFleet, RELAY_POST_TRAIT, shipsEngaged } from '../../packages/shared-core/src/index';
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
} from './game';

/** Как часто ходит локальный ИИ (игровое время). Чаще — только лишние прогоны. */
export const AI_STEP_MS = 2 * HOUR;

/**
 * Ключ памяти проб авто-штурма: «этот флот в этом часе мира, на этой орбите, над
 * миром этого владельца». Проба стоит прогона редьюсера, а цикл гоняется каждый кадр,
 * поэтому обречённую пару «орбита → штурм» запоминаем и не пережимаем; сменился час,
 * орбита или владелец мира — ключ другой, и попытка повторится. Час — номер часа мира,
 * а не миг: миг меняется каждый кадр, и с ним память не срабатывала никогда (на FFA-20
 * к 22-му дню пробы стоили ~90 мс каждого кадра).
 */
export function autoProbeKey(f: Fleet, now: number, hereOwner: string | null): string {
  return `${Math.floor(now / HOUR)}|${f.orbit ?? ''}|${f.location ?? ''}|${hereOwner ?? ''}`;
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
  /** RETR-2: авто-отступление — увести флоты, чей корпус просел до порога приказа. */
  driveAutoRetreat(): void;
  /** Новый матч: часы ИИ и память проб начинаются заново. */
  reset(): void;
}

export function initSoloDrivers(host: SoloHost): SoloDrivers {
  /** Обречённые пары «орбита → штурм»: id флота → ключ состояния. */
  const probed = new Map<string, string>();
  /** Пары флотов, которых ядро не свело в бой: пара → ключ (час мира, узел, отношения). */
  const unclashed = new Map<string, string>();
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
    // Непилотируемые обитатели карты не занимают очередь хода: появление/удаление
    // такого NPC иначе сдвигает фазы всех ботов, хотя самому NPC ходить нечем.
    // Кресла людей остаются в расписании для делегирования Хранителю; NPC — только
    // при явном включении в контроллеры хоста.
    const botSeats = host.aiSeats();
    const seats = Object.keys(current.players).filter((id) => !current.players[id]!.npc || botSeats.has(id));
    let planned = false;
    for (let slices = 0; slices < AI_SLICES_PER_FRAME; ) {
      const step = ai.step(current.time, seats, policyFor, planFor);
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
    // Пост сети Роя (большой ретранслятор) держит связь, а не штурмует мир, где стоит.
    const post = (f: Fleet): boolean =>
      f.units.some((u) => data.units[u.unit]?.traits.includes(RELAY_POST_TRAIT) ?? false);
    // Кто стоит на каждом узле живыми отрядами, кроме мин, — одним проходом: проверка «есть
    // ли здесь враг» перебирала все флоты карты на каждый флот у чужого мира.
    const ownersAt = new Map<string, Set<string>>();
    for (const g of Object.values(s.fleets)) {
      if (g.location == null || !g.units.some((u) => u.count > 0) || isMineFleet(g, data)) continue;
      const owners = ownersAt.get(g.location);
      if (owners) owners.add(g.owner);
      else ownersAt.set(g.location, new Set([g.owner]));
    }
    for (const f of Object.values(s.fleets)) {
      if (f.location == null || f.movement || f.battleId) continue;
      if (sentinels.has(f.id) || post(f) || isMineFleet(f, data)) continue;
      const mine = f.owner === host.me();
      // Чужие всегда давят цикл захвата; свой флот — только если игрок сам включил
      // авто-штурм (CC-2), иначе штурмами он распоряжается руками.
      if (mine && !host.autoAssault(f.id)) continue;
      const here = s.planets[f.location];
      if (!here || here.owner === f.owner) continue; // свой мир штурмовать нечего
      // Мина (SM-3.6) захвату не мешает — как и в ядре (`captureOnArrival`).
      const owners = ownersAt.get(f.location);
      const enemyHere = owners !== undefined && owners.size > (owners.has(f.owner) ? 1 : 0);
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
   * свести их принудительно. Флот, чей десант дерётся на земле, для орбиты свободен
   * (MSB-8, `shipsEngaged`) — как и в ядре.
   */
  function checkFleetClashes(): void {
    const s = host.state();
    const me = host.me();
    const fleets = Object.values(s.fleets);
    // Пару ищем только среди флотов того же узла: перебор всех пар карты стоил кадру
    // ~2 мс на FFA-50. Флоты узла идут в порядке карты, поэтому и пары — тем же порядком.
    const atNode = new Map<string, Fleet[]>();
    for (const g of fleets) {
      if (!g.location) continue;
      const here = atNode.get(g.location);
      if (here) here.push(g);
      else atNode.set(g.location, [g]);
    }
    for (const f of fleets) {
      if (!f.location || f.movement || shipsEngaged(s, f)) continue;
      // Мина (SM-3.6) — не противник в бою: «Атака» по ней — подрыв, и сводить с ней
      // стоящий рядом флот каждый кадр значило бы взрывать его заряд за зарядом.
      if (isMineFleet(f, data)) continue;
      for (const g of atNode.get(f.location)!) {
        if (g.id <= f.id) continue; // пара обрабатывается один раз
        if (!g.location || g.movement || shipsEngaged(s, g) || isMineFleet(g, data)) continue;
        if (f.owner === g.owner || f.location !== g.location) continue;
        // Бой начинается со стороны игрока, если он в паре есть.
        const myFleet = f.owner === me ? f : g.owner === me ? g : f;
        const foeFleet = myFleet === f ? g : f;
        // Отказ ядра (чаще всего стороны не во вражде: в FFA все начинают в мире) стоит
        // прогона редьюсера, а цикл гоняется каждый кадр. Отвергнутую пару не пережимаем:
        // повтор — в новом часе мира, на другом узле или когда сменились отношения сторон.
        const pair = `${f.id}|${g.id}`;
        const key = `${Math.floor(s.time / HOUR)}|${f.location}|${getStance(s, f.owner, g.owner)}`;
        if (unclashed.get(pair) === key) continue;
        host.applyLocal(engageFleet(myFleet.owner, myFleet.id, foeFleet.id));
        const after = host.state();
        const engaged = after.fleets[myFleet.id];
        if (!engaged || !shipsEngaged(after, engaged)) unclashed.set(pair, key);
        else unclashed.delete(pair);
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
    driveAutoRetreat,
    reset: () => {
      ai.reset(host.state().time);
      probed.clear();
      unclashed.clear();
    },
  };
}
