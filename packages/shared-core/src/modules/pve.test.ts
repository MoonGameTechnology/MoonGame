import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { pveModule } from './pve';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { AdvanceResult, Context, MatchConfig } from '../action/types';
import { deepFreeze } from '../util/clone';
import { MS_PER_HOUR } from '../util/time';

// pveModule — общий NPC-враг, приходящий волнами по расписанию (PVE-3). Мир собран
// из одного модуля: это и есть доказательство изоляции (модуль ни от кого не зависит).

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    drone: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 10 } },
    hunter: { faction: 'swarm', stats: { attack: 9, defense: 4, speed: 40 } },
    spore: { faction: 'swarm', domain: 'ground', stats: { attack: 5, defense: 2, speed: 0 } },
  },
  technologies: {
    boon_a: { name: 'Boon A', branch: 'command', effects: { combatDamageBonus: 0.1 } },
    boon_b: { name: 'Boon B', branch: 'command', effects: { fleetSpeedBonus: 0.1 } },
    other: { name: 'Other', branch: 'command', effects: {} },
  },
  factions: {
    swarm: { name: 'Swarm', startingLoadout: { fleet: [{ unit: 'drone', count: 2 }] } },
    vanguard: { name: 'Vanguard' },
  },
  buildings: {},
  events: {},
  modes: {
    waves: {
      name: 'Waves',
      modules: ['pve'],
      pve: { waves: 2, npcFaction: 'swarm', waveIntervalHours: 6 },
    },
    // Тот же штурм, но состав волны объявляет САМ режим (PVR-1.3).
    fielded: {
      name: 'Fielded',
      modules: ['pve'],
      pve: {
        waves: 2,
        npcFaction: 'swarm',
        waveIntervalHours: 6,
        waveFleet: [
          { unit: 'hunter', count: 2 },
          { unit: 'drone', count: 1 },
        ],
        waveLanding: [{ unit: 'spore', count: 3 }],
        boons: ['boon_a', 'boon_b'],
      },
    },
    // Тот же штурм, но забег засчитывается УДЕРЖАНИЕМ после последней волны (PVR-2.5).
    held: {
      name: 'Held',
      modules: ['pve'],
      pve: { waves: 2, npcFaction: 'swarm', waveIntervalHours: 6, holdHours: 5 },
    },
    plain: { name: 'Plain' },
  },
});

const kernel = createKernel([pveModule]);
const ctx = (now: number, modeId?: string): Context => ({
  now,
  data,
  config: { timeScale: 1, modeId } as MatchConfig,
});

function player(id: string, faction: string): Player {
  return { id, name: id, faction, status: 'active', resources: {} };
}
function planet(id: string, owner: string | null): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    kind: 'planet',
  };
}

function world(): GameState {
  const base = createInitialState({ seed: 'pve', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: { human: player('human', 'vanguard'), swarm: player('swarm', 'swarm') },
    planets: { home: planet('home', 'human'), hive: planet('hive', 'swarm') },
  };
}

/** Двигает мир до `to`, начиная со свежего состояния (или переданного). */
function advance(to: number, modeId?: string, from: GameState = world()): AdvanceResult {
  return kernel.advanceTo(from, ctx(to, modeId));
}
function ok(res: AdvanceResult): GameState {
  if (!res.ok) throw new Error('advance failed: ' + res.code);
  return res.state;
}

/** Мир, у которого модуль УЖЕ завёл счётчик и взвёл первую волну (на 6ч). Заведение
 *  и приход волны — два разных продвижения часов: ядро не переигрывает спан, который
 *  только что прошло, поэтому событие, поставленное внутри `time.advanced`, ждёт
 *  следующего вызова. Это и есть живой режим сервера — часы идут постоянно. */
const seeded = (): GameState => ok(advance(MS_PER_HOUR, 'waves'));

describe('pveModule — волны (PVE-3)', () => {
  it('матч без PvE-режима не получает ни state.pve, ни расписания', () => {
    // Механику включают ДАННЫЕ: у режима `plain` нет секции `pve`, значит модуль здесь
    // не существует для игры. То же и без режима вовсе.
    for (const modeId of ['plain', undefined]) {
      const state = ok(advance(MS_PER_HOUR, modeId));
      expect({ modeId, pve: state.pve, scheduled: state.scheduled.length }).toEqual({
        modeId,
        pve: undefined,
        scheduled: 0,
      });
    }
  });

  it('PvE-режим заводит счётчик и ставит первую волну в расписание', () => {
    const state = ok(advance(MS_PER_HOUR, 'waves'));
    // Первая волна отсчитывается от НАЧАЛА спана, а не от его конца: иначе матч,
    // восстановленный и догнавший неделю одним вызовом, отодвинул бы стартовую волну
    // на неделю вперёд.
    expect(state.pve).toEqual({
      waveNumber: 0,
      totalWaves: 2,
      npcPlayerId: 'swarm',
      nextWaveAt: 6 * MS_PER_HOUR,
    });
    expect(state.scheduled.map((s) => s.type)).toEqual(['pve.wave']);
  });

  it('нет места под фракцию Роя — модуль остаётся инертным, а не выдумывает врага', () => {
    const solo = { ...world(), players: { human: player('human', 'vanguard') } };
    const state = ok(advance(MS_PER_HOUR, 'waves', solo));
    expect(state.pve).toBeUndefined();
    expect(state.scheduled).toEqual([]);
  });

  it('пришедшая волна спавнит флот NPC и ставит следующую', () => {
    const state = ok(advance(8 * MS_PER_HOUR, 'waves', seeded()));
    expect(state.pve?.waveNumber).toBe(1);
    const waves = Object.values(state.fleets).filter((f) => f.owner === 'swarm');
    expect(waves).toHaveLength(1);
    expect(waves[0]?.location).toBe('hive'); // мир, который держит NPC
    // Волна N — это N стартовых составов фракции: ramp живёт в контенте, не в коде.
    expect(waves[0]?.units).toEqual([{ unit: 'drone', count: 2 }]);
    expect(state.pve?.nextWaveAt).toBe(12 * MS_PER_HOUR); // следующая взведена
  });

  it('вторая волна крепче первой и на ней штурм кончается', () => {
    const state = ok(advance(20 * MS_PER_HOUR, 'waves', seeded()));
    expect(state.pve?.waveNumber).toBe(2); // totalWaves достигнут
    expect(state.pve?.nextWaveAt).toBeUndefined(); // больше ничего не взводится
    expect(state.scheduled).toEqual([]);
    expect(state.fleets['pve:wave:2']?.units).toEqual([{ unit: 'drone', count: 4 }]);
  });

  it('дальнейший ход времени волн больше не приносит (штурм закончен)', () => {
    const after = ok(advance(200 * MS_PER_HOUR, 'waves', seeded()));
    expect(after.pve?.waveNumber).toBe(2);
    expect(Object.keys(after.fleets).filter((id) => id.startsWith('pve:wave:')).sort()).toEqual([
      'pve:wave:1',
      'pve:wave:2',
    ]);
  });

  it('детерминизм: членение advance не меняет результат', () => {
    // Волны едут по `schedule`, а не по «тикам», поэтому один прыжок и четыре шага
    // обязаны сойтись бит-в-бит.
    const oneJump = ok(advance(20 * MS_PER_HOUR, 'waves', seeded()));
    let stepwise = seeded();
    for (const hrs of [7, 11, 15, 20]) {
      stepwise = ok(advance(hrs * MS_PER_HOUR, 'waves', stepwise));
    }
    expect(JSON.stringify(stepwise.pve)).toBe(JSON.stringify(oneJump.pve));
    expect(JSON.stringify(stepwise.fleets)).toBe(JSON.stringify(oneJump.fleets));
  });

  it('не мутирует вход', () => {
    const frozen = deepFreeze(world());
    expect(kernel.advanceTo(frozen, ctx(20 * MS_PER_HOUR, 'waves')).ok).toBe(true);
  });
});

describe('pveModule — Рой враждебен с первого часа (PVR-1.5)', () => {
  // Найдено прогоном и подтверждено ревью OBS-02: волны исправно СОЗДАВАЛИСЬ и молча
  // копились в улье. Карта сажает стороны в `peace` (конвенция free-for-all), а бот
  // войну первым не объявляет — значит PvE-матч шёл без единого боя. Враждебность
  // объявляет тот, кто знает, КТО враг: сам модуль, по `npcFaction` режима.
  it('объявляет войну между NPC и каждым игроком при заведении штурма', () => {
    const state = seeded();
    expect(state.diplomacy?.['human|swarm']).toBe('war');
  });

  it('перебивает мир, засеянный картой: PvE — это не free-for-all', () => {
    const atPeace: GameState = { ...world(), diplomacy: { 'human|swarm': 'peace' } };
    const state = ok(advance(MS_PER_HOUR, 'waves', atPeace));
    expect(state.diplomacy?.['human|swarm']).toBe('war');
  });

  it('не трогает отношения между СВОИМИ — союз игроков переживает штурм', () => {
    const coop: GameState = {
      ...world(),
      players: {
        human: player('human', 'vanguard'),
        ally: player('ally', 'vanguard'),
        swarm: player('swarm', 'swarm'),
      },
      diplomacy: { 'ally|human': 'alliance' },
    };
    const state = ok(advance(MS_PER_HOUR, 'waves', coop));
    expect(state.diplomacy?.['ally|human']).toBe('alliance'); // союз не тронут
    expect(state.diplomacy?.['ally|swarm']).toBe('war'); // а с Роем воюют оба
    expect(state.diplomacy?.['human|swarm']).toBe('war');
  });

  it('в матче без PvE-режима отношений не трогает вовсе', () => {
    const atPeace: GameState = { ...world(), diplomacy: { 'human|swarm': 'peace' } };
    const state = ok(advance(MS_PER_HOUR, 'plain', atPeace));
    expect(state.diplomacy?.['human|swarm']).toBe('peace');
  });
});

describe('pveModule — состав волны объявляет режим (PVR-1.3)', () => {
  // Волна брала состав из `startingLoadout.fleet` фракции NPC — то есть из ответа на
  // ДРУГОЙ вопрос: «с чем начинает матч ИГРОК за эту фракцию». Рой играбелен, поэтому
  // усилить штурм через это поле значило бы переверстать баланс каждой партии, где Рой
  // взяли в руки, а подкрутить фракцию — молча переверстать штурм.
  const fieldedSeed = (): GameState => ok(advance(MS_PER_HOUR, 'fielded'));

  it('волна собирается из waveFleet режима, а не из стартового флота фракции', () => {
    const state = ok(advance(8 * MS_PER_HOUR, 'fielded', fieldedSeed()));
    expect(state.fleets['pve:wave:1']?.units).toEqual([
      { unit: 'hunter', count: 2 },
      { unit: 'drone', count: 1 },
    ]);
  });

  it('ramp тот же: волна N — это N объявленных составов', () => {
    const state = ok(advance(20 * MS_PER_HOUR, 'fielded', fieldedSeed()));
    expect(state.fleets['pve:wave:2']?.units).toEqual([
      { unit: 'hunter', count: 4 },
      { unit: 'drone', count: 2 },
    ]);
  });

  it('режим БЕЗ waveFleet по-прежнему берёт стартовый флот фракции (нет данных → база)', () => {
    // Инвариант №3 в его данных-ипостаси: не объявленное поле откатывает к прежнему
    // поведению, а не роняет матч и не выдаёт пустую волну.
    const state = ok(advance(8 * MS_PER_HOUR, 'waves', seeded()));
    expect(state.fleets['pve:wave:1']?.units).toEqual([{ unit: 'drone', count: 2 }]);
  });
});

describe('pveModule — волна везёт десант (PVR-1.6)', () => {
  // Без десанта волна могла взять только ПУСТОЙ сектор — приходом. Захват мира с
  // гарнизоном двухфазный, и вторая фаза требует пехоты, поэтому защищённый дом
  // игрока был непобедим: штурм вставал на орбите навсегда, а `pve-failed` был
  // недостижим. Это и делало «забег» невозможным проиграть.
  const fieldedSeed = (): GameState => ok(advance(MS_PER_HOUR, 'fielded'));

  it('везёт объявленный десант, масштабированный тем же номером волны', () => {
    const state = ok(advance(20 * MS_PER_HOUR, 'fielded', fieldedSeed()));
    expect(state.fleets['pve:wave:1']?.landing).toEqual([{ unit: 'spore', count: 3 }]);
    expect(state.fleets['pve:wave:2']?.landing).toEqual([{ unit: 'spore', count: 6 }]);
  });

  it('режим без waveLanding даёт флот БЕЗ поля landing, а не с пустым', () => {
    // Форма флота у режима, который десант не объявлял, обязана остаться прежней:
    // пустой массив — это уже другое состояние, и он поехал бы в снапшот матча.
    const state = ok(advance(8 * MS_PER_HOUR, 'waves', seeded()));
    expect(state.fleets['pve:wave:1']).toBeDefined();
    expect(state.fleets['pve:wave:1']).not.toHaveProperty('landing');
  });
});

describe('pveModule — усиление между волнами (PVR-1.4)', () => {
  // То, что делает забег забегом: пережил волну — стал сильнее. Механизм тот же, что
  // доказал `metaGrant`: скрытая сессионная технология, выданная `completed`, и её
  // бонусы едут обычными хуками. Нового кода в движке под каждое усиление нет.
  const fieldedSeed = (): GameState => ok(advance(MS_PER_HOUR, 'fielded'));
  /** Приказ подаётся в ТЕКУЩЕЕ время мира: час раньше состояния — это уже другая
   *  проверка ядра, и тест падал бы на ней, а не на усилении. */
  const take = (from: GameState, tech: string, who = 'human') =>
    kernel.applyAction(
      from,
      { id: 'a1', type: 'pve.boon', playerId: who, payload: { tech }, issuedAt: 0 },
      ctx(from.time, 'fielded'),
    );

  it('пришедшая волна даёт выживший стороне один выбор', () => {
    const state = ok(advance(8 * MS_PER_HOUR, 'fielded', fieldedSeed()));
    expect(state.pve?.boons).toEqual({ human: 1 });
  });

  it('долг копится: не зашёл за первым — второй его не съедает', () => {
    const state = ok(advance(20 * MS_PER_HOUR, 'fielded', fieldedSeed()));
    expect(state.pve?.boons?.human).toBe(2);
  });

  it('место без мира выбора не получает — оно проигрывает, а не выживает', () => {
    const doomed: GameState = { ...world(), planets: { hive: planet('hive', 'swarm') } };
    const state = ok(advance(8 * MS_PER_HOUR, 'fielded', ok(advance(MS_PER_HOUR, 'fielded', doomed))));
    expect(state.pve?.boons ?? {}).toEqual({});
  });

  it('NPC выбора не получает — усиливается игрок, а не Рой', () => {
    const state = ok(advance(8 * MS_PER_HOUR, 'fielded', fieldedSeed()));
    expect(state.pve?.boons?.swarm).toBeUndefined();
  });

  it('map inhabitants receive no survival boons even while holding a base', () => {
    const start = world();
    start.players.pirates = { ...player('pirates', 'vanguard'), npc: 'pirate' };
    start.planets.den = planet('den', 'pirates');
    const state = ok(advance(8 * MS_PER_HOUR, 'fielded', ok(advance(MS_PER_HOUR, 'fielded', start))));
    expect(state.pve?.boons).toEqual({ human: 1 });
  });

  it('режим без пула долгов не заводит вовсе', () => {
    const state = ok(advance(8 * MS_PER_HOUR, 'waves', seeded()));
    expect(state.pve?.boons).toBeUndefined();
  });

  it('выбранное усиление ложится в завершённые и списывает долг', () => {
    const owed = ok(advance(8 * MS_PER_HOUR, 'fielded', fieldedSeed()));
    const r = take(owed, 'boon_a');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.human?.technologies?.completed).toEqual(['boon_a']);
    expect(r.state.pve?.boons?.human).toBe(0);
  });

  it('второй раз без долга — отказ, а не тихая выдача', () => {
    const owed = ok(advance(8 * MS_PER_HOUR, 'fielded', fieldedSeed()));
    const first = take(owed, 'boon_a');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = take(first.state, 'boon_b');
    expect(second).toMatchObject({ ok: false, code: 'E_NO_BOON' });
  });

  it('технология ВНЕ пула не выдаётся, даже если она есть в каталоге', () => {
    // Иначе действие превращается в «выдай себе любую науку»: пул режима — это и есть
    // граница, а не подсказка интерфейса.
    const owed = ok(advance(8 * MS_PER_HOUR, 'fielded', fieldedSeed()));
    expect(take(owed, 'other')).toMatchObject({ ok: false, code: 'E_UNKNOWN_BOON' });
  });

  it('то же усиление дважды — отказ', () => {
    const owed = ok(advance(20 * MS_PER_HOUR, 'fielded', fieldedSeed())); // долг 2
    const first = take(owed, 'boon_a');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(take(first.state, 'boon_a')).toMatchObject({ ok: false, code: 'E_ALREADY_TAKEN' });
  });

  it('в матче без PvE-режима действие отвергается', () => {
    const plain = ok(advance(MS_PER_HOUR, 'plain'));
    const r = kernel.applyAction(
      plain,
      { id: 'a1', type: 'pve.boon', playerId: 'human', payload: { tech: 'boon_a' }, issuedAt: 0 },
      ctx(MS_PER_HOUR, 'plain'),
    );
    expect(r).toMatchObject({ ok: false, code: 'E_NOT_PVE' });
  });
});

describe('pveModule — удержание после последней волны (PVR-2.5)', () => {
  // Решение владельца 2026-09-23: «победа — выстоять». Модуль ставит СРОК, а вердикт
  // выносит `victoryModule`; здесь — только срок и отметка на таймлайне.
  const HOUR = MS_PER_HOUR;
  const seededHeld = (from: GameState = world()): GameState => ok(advance(HOUR, 'held', from));
  const holds = (s: GameState): Array<[string, number]> =>
    s.scheduled.filter((e) => e.type === 'pve.hold').map((e) => [e.type, e.at]);

  it('последняя волна ставит срок удержания и отметку ровно на этот срок', () => {
    // Волны на 6-м и 12-м часу, удержание 5 часов: срок — 17-й час.
    const state = ok(advance(13 * HOUR, 'held', seededHeld()));
    expect(state.pve?.waveNumber).toBe(2);
    expect(state.pve?.holdUntil).toBe(17 * HOUR);
    expect(holds(state)).toEqual([['pve.hold', 17 * HOUR]]);
  });

  it('пока волны идут, срока нет', () => {
    const state = ok(advance(7 * HOUR, 'held', seededHeld()));
    expect(state.pve?.waveNumber).toBe(1);
    expect(state.pve?.holdUntil).toBeUndefined();
    expect(holds(state)).toEqual([]);
  });

  it('режим без holdHours срока не ставит — прежнее правило, «нет данных → база»', () => {
    const state = ok(advance(20 * HOUR, 'waves', seeded()));
    expect(state.pve?.waveNumber).toBe(2);
    expect(state.pve?.holdUntil).toBeUndefined();
    expect(holds(state)).toEqual([]);
  });

  it('срок ставится, даже когда последней волне негде высадиться', () => {
    // Ранняя зачистка улья лишает волны места спавна, но счётчик доходит до конца —
    // и забег обязан получить свой срок, а не зависнуть без него.
    const noHive: GameState = { ...world(), planets: { home: planet('home', 'human') } };
    const state = ok(advance(13 * HOUR, 'held', seededHeld(noHive)));
    expect(Object.keys(state.fleets)).toEqual([]);
    expect(state.pve?.holdUntil).toBe(17 * HOUR);
  });

  it('детерминизм: членение advance не меняет срок', () => {
    const oneJump = ok(advance(20 * HOUR, 'held', seededHeld()));
    let stepwise = seededHeld();
    for (const hrs of [7, 12, 13, 16, 20]) stepwise = ok(advance(hrs * HOUR, 'held', stepwise));
    expect(JSON.stringify(stepwise.pve)).toBe(JSON.stringify(oneJump.pve));
    expect(JSON.stringify(stepwise.scheduled)).toBe(JSON.stringify(oneJump.scheduled));
  });

  it('мир, восстановленный ПОСЛЕ последней волны, получает срок на первой же отметке', () => {
    // Так восстанавливает забег переносимый сейв (YAG-2.1): свежий засеянный мир, счётчик
    // выставлен руками, срока в сейве нет. Без этой отметки забег после восстановления
    // нельзя было бы выиграть удержанием вовсе — только зачисткой.
    const fresh = seededHeld();
    const restored: GameState = { ...fresh, pve: { ...fresh.pve!, waveNumber: 2 } };
    delete restored.pve!.nextWaveAt;
    const state = ok(advance(7 * HOUR, 'held', restored));
    expect(state.pve?.waveNumber).toBe(2); // лишней волны не пришло
    expect(Object.keys(state.fleets)).toEqual([]);
    expect(state.pve?.holdUntil).toBe(11 * HOUR); // отметка на 6-м часу + 5 часов
    expect(holds(state)).toEqual([['pve.hold', 11 * HOUR]]);
  });

  it('уже взведённый срок повторная отметка не переносит', () => {
    const state = ok(advance(13 * HOUR, 'held', seededHeld()));
    const again = ok(advance(30 * HOUR, 'held', state));
    expect(again.pve?.holdUntil).toBe(17 * HOUR);
  });
});

