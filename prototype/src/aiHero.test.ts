// AI-BAL-8: ветка героев у ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется. Герой ПОСЕЯН во флоте каждого места (`matchSetup`) и исправно
// дерётся как корпус — поэтому «мёртвым контентом» он не числился ни разу, и это скрывало
// настоящую дыру: всё, что вокруг него, в измерении не участвовало. Бот не звал ни одного
// из четырёх геройских действий, а значит матч не видел ни трёх спящих героев ростера
// (`hero.spawn`), ни двух деревьев навыков по четыре узла (`hero.skill.unlock`), ни трёх
// фитингов (`hero.fit`), ни диспетчера способностей (`hero.ability`).
//
// Форма правил — та же, что у технологий (AI-BAL-1): бот не «строит билд», он просто не
// оставляет пустыми выданные ему слоты. Всё, что можно проверить ядром (ветка архетипа,
// `requires`, казна, кэп активных, кулдаун), ядром и проверяется — тесты ниже пиннят
// именно ЗЕРКАЛО этих гейтов, то есть что бот не сыплет заведомо отбиваемыми приказами.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import { data } from './prototypeData';
import type { Action, GameState, Hero } from '../../packages/shared-core/src/index';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const payloads = <T>(actions: Action[], type: string): T[] =>
  only(actions, type).map((a) => a.payload as T);
const orders = (s: GameState, profile: 'basic' | 'test' = 'test'): Action[] =>
  aiOrders(s, 'p2', 'expand', profile);

/** Домашний мир места (тот, где стоит космопорт). */
const homeOf = (s: GameState, seat: string): string =>
  Object.values(s.planets).find(
    (p) => p.owner === seat && p.buildings.some((b) => b.type === 'spaceport'),
  )!.id;

/** Казна, на которую хватает любого узла дерева и любого фитинга каталога. */
function rich(s: GameState): GameState {
  return {
    ...s,
    players: {
      ...s.players,
      p2: {
        ...s.players.p2!,
        resources: { credits: 4000, metal: 6000, food: 900, energy: 900, microelectronics: 400 },
      },
    },
  };
}

const heroesOf = (s: GameState, seat: string): Hero[] =>
  Object.values(s.heroes ?? {}).filter((x) => x.owner === seat);
/** Главный герой места — единственный, кого матч разворачивает кораблём. */
const mainHero = (s: GameState, seat: string): Hero =>
  heroesOf(s, seat).find((x) => x.alive === true)!;

/** Подменяет одного героя, сохраняя остальных. */
function withHero(s: GameState, id: string, patch: Partial<Hero>): GameState {
  return { ...s, heroes: { ...s.heroes, [id]: { ...s.heroes![id]!, ...patch } } };
}

describe('AI-BAL-8 — подъём ростера (`hero.spawn`)', () => {
  it('поднимает спящих героев ростера — до кэпа активных, который знает ЯДРО', () => {
    // Матч раздаёт четверых, кораблём командует только главный. Кэп ядра — 3 активных,
    // значит подъёмов ровно два: третьего места в кэпе уже нет.
    const s = rich(game2());
    const spawns = payloads<{ heroId: string; at: string }>(orders(s), 'hero.spawn');
    expect(spawns).toHaveLength(2);
    expect(spawns.every((p) => p.at === homeOf(s, 'p2'))).toBe(true);
    expect(new Set(spawns.map((p) => p.heroId)).size).toBe(2); // разные герои
    expect(spawns.some((p) => p.heroId === mainHero(s, 'p2').id)).toBe(false);
  });

  it('упёршись в кэп, приказов больше не отдаёт — а не сыплет `E_HERO_CAP`', () => {
    let s = rich(game2());
    const sleeping = heroesOf(s, 'p2').filter((x) => x.alive !== true);
    // Двое подняты — кэп (3 вместе с главным) выбран.
    for (const x of sleeping.slice(0, 2)) {
      s = withHero(s, x.id, { alive: true, fleetId: 'p2-1' });
    }
    expect(only(orders(s), 'hero.spawn')).toHaveLength(0);
  });

  it('героя на респаун-кулдауне не поднимает', () => {
    let s = rich(game2());
    for (const x of heroesOf(s, 'p2')) {
      if (x.alive !== true) s = withHero(s, x.id, { cooldowns: { respawn: s.time + 3_600_000 } });
    }
    expect(only(orders(s), 'hero.spawn')).toHaveLength(0);
  });

  it('ПРОТУХШИЙ `fleetId` не держит место в кэпе', () => {
    // Ядро считает активными только тех, у кого корабль ЖИВ (`activeHeroCount`); герой
    // со ссылкой на снесённый флот мёртв для кэпа, и бот обязан считать так же — иначе
    // ростер навсегда остался бы неподнятым.
    let s = rich(game2());
    const sleeping = heroesOf(s, 'p2').filter((x) => x.alive !== true);
    for (const x of sleeping.slice(0, 2)) {
      s = withHero(s, x.id, { alive: true, fleetId: 'fleet:gone' });
    }
    expect(only(orders(s), 'hero.spawn').length).toBeGreaterThan(0);
  });

  it('ИГРОВОЙ бот ростер не поднимает', () => {
    expect(only(orders(rich(game2()), 'basic'), 'hero.spawn')).toHaveLength(0);
  });
});

describe('AI-BAL-8 — дерево навыков (`hero.skill.unlock`)', () => {
  it('берёт корневой узел СВОЕЙ ветки, по одному за тик', () => {
    const s = rich(game2());
    const picks = payloads<{ heroId: string; node: string }>(orders(s), 'hero.skill.unlock');
    expect(picks).toHaveLength(1);
    const hero = s.heroes![picks[0]!.heroId]!;
    const branch = data.heroes[hero.archetype!]!.branch;
    expect(data.heroSkillTrees[picks[0]!.node]!.branch).toBe(branch);
  });

  it('узел ЧУЖОЙ ветки не берётся — ядро ответило бы `E_WRONG_BRANCH`', () => {
    // Транс-герою psionic-корень недоступен: проверяем, что бот не предлагает его,
    // когда взяты все доступные узлы его собственной ветки.
    const s = rich(game2());
    const hero = mainHero(s, 'p2'); // commander → transhuman
    const all = Object.keys(data.heroSkillTrees);
    const own = all.filter((id) => data.heroSkillTrees[id]!.branch === 'transhuman');
    let staged = withHero(s, hero.id, { skills: own });
    // и остальные герои места — тоже «всё взяли», чтобы очередь дошла до проверки ветки
    for (const x of heroesOf(staged, 'p2')) {
      if (x.id !== hero.id) staged = withHero(staged, x.id, { skills: all });
    }
    expect(only(orders(staged), 'hero.skill.unlock')).toHaveLength(0);
  });

  it('узел без выполненных `requires` не берётся', () => {
    // `overclocked_helm` требует `neural_lace`: первым всегда идёт корень.
    const s = rich(game2());
    const pick = payloads<{ node: string }>(orders(s), 'hero.skill.unlock')[0]!;
    expect(data.heroSkillTrees[pick.node]!.requires ?? []).toHaveLength(0);
  });

  it('пустая казна — приказа нет (а не `E_INSUFFICIENT` каждые два часа)', () => {
    const s = game2(); // стартовая казна не тянет ни один узел + резерв
    expect(only(orders(s), 'hero.skill.unlock')).toHaveLength(0);
  });

  it('ИГРОВОЙ бот дерево не качает', () => {
    expect(only(orders(rich(game2()), 'basic'), 'hero.skill.unlock')).toHaveLength(0);
  });
});

describe('AI-BAL-8 — фитинги (`hero.fit`)', () => {
  it('ставит фитинг в свободный слот, по одному за тик', () => {
    const s = rich(game2());
    const fits = payloads<{ heroId: string; fitting: string }>(orders(s), 'hero.fit');
    expect(fits).toHaveLength(1);
    expect(data.heroFittings[fits[0]!.fitting]).toBeDefined();
  });

  it('уже установленный фитинг не ставится повторно', () => {
    const s = rich(game2());
    const first = payloads<{ heroId: string; fitting: string }>(orders(s), 'hero.fit')[0]!;
    const staged = withHero(s, first.heroId, { fittings: [first.fitting] });
    const next = payloads<{ heroId: string; fitting: string }>(orders(staged), 'hero.fit')[0]!;
    expect(next.fitting).not.toBe(first.fitting);
  });

  it('слоты кончились — приказа нет', () => {
    // Слоты считает архетип; заполняем каждому герою столько, сколько у него слотов.
    let s = rich(game2());
    for (const x of heroesOf(s, 'p2')) {
      const slots = data.heroes[x.archetype!]?.slots ?? 0;
      s = withHero(s, x.id, { fittings: Object.keys(data.heroFittings).slice(0, slots) });
    }
    expect(only(orders(s), 'hero.fit')).toHaveLength(0);
  });

  it('ИГРОВОЙ бот фитинги не ставит', () => {
    expect(only(orders(rich(game2()), 'basic'), 'hero.fit')).toHaveLength(0);
  });
});

describe('AI-BAL-8 — способности (`hero.ability`)', () => {
  /** Ставит флот главного героя в бой — единственный повод для боевых способностей. */
  function heroInBattle(s: GameState): GameState {
    const hero = mainHero(s, 'p2');
    const fleet = s.fleets[hero.fleetId!]!;
    return {
      ...s,
      battles: {
        'battle:1': {
          id: 'battle:1',
          location: fleet.location!,
          phase: 'orbital',
          attacker: { ref: { kind: 'fleet', fleetId: fleet.id }, owner: 'p2' },
          defender: { ref: { kind: 'fleet', fleetId: 'f:foe' }, owner: 'p1' },
          round: 2,
        },
      },
      fleets: {
        ...s.fleets,
        [fleet.id]: { ...fleet, battleId: 'battle:1' },
        'f:foe': {
          id: 'f:foe',
          owner: 'p1',
          location: fleet.location!,
          units: [{ unit: 'cruiser', count: 3 }],
          landing: [],
          traits: [],
          movement: null,
          orbit: 'near',
          battleId: 'battle:1',
        },
      },
    };
  }

  it('боевая аура кастуется, когда флот героя ДЕРЁТСЯ', () => {
    const s = heroInBattle(rich(game2()));
    const casts = payloads<{ heroId: string; abilityId: string }>(orders(s), 'hero.ability');
    const types = casts.map((c) => data.heroAbilities[c.abilityId]!.type);
    expect(types).toContain('aura');
  });

  it('без боя боевых кастов нет — аура живёт часами, а кулдаун идёт впустую', () => {
    const s = rich(game2());
    const casts = payloads<{ abilityId: string }>(orders(s), 'hero.ability');
    const types = new Set(casts.map((c) => data.heroAbilities[c.abilityId]!.type));
    expect(types.has('aura')).toBe(false);
    expect(types.has('reveal')).toBe(false);
  });

  it('кулдаун читается ТЕМ ЖЕ ключом, что ведёт гейт: rally и bulwark делят окно', () => {
    // Ключ кулдауна в ядре — по ТИПУ (`fx:aura`), а не по id способности. Знай бот это
    // неверно, он кастовал бы вторую ауру каждый тик и получал `E_COOLDOWN`.
    const s = heroInBattle(rich(game2()));
    const hero = mainHero(s, 'p2');
    const staged = withHero(s, hero.id, { cooldowns: { 'fx:aura': s.time + 3_600_000 } });
    const casts = payloads<{ abilityId: string }>(orders(staged), 'hero.ability');
    expect(casts.map((c) => data.heroAbilities[c.abilityId]!.type)).not.toContain('aura');
  });

  it('одна способность на героя за тик', () => {
    const s = heroInBattle(rich(game2()));
    const byHero = new Map<string, number>();
    for (const c of payloads<{ heroId: string }>(orders(s), 'hero.ability')) {
      byHero.set(c.heroId, (byHero.get(c.heroId) ?? 0) + 1);
    }
    expect([...byHero.values()].every((n) => n === 1)).toBe(true);
  });

  it('`recall` и маркеры `spawn_*` не кастуются вовсе', () => {
    // Отзыв выдёргивает героя с фронта ровно тогда, когда он нужнее всего; маркеры
    // вообще не кастуемы — ядро читает их наличием и ответило бы `E_NO_EFFECT`.
    const s = heroInBattle(rich(game2()));
    const casts = payloads<{ abilityId: string }>(orders(s), 'hero.ability');
    const types = casts.map((c) => data.heroAbilities[c.abilityId]!.type);
    expect(types).not.toContain('recall');
    expect(types.some((t) => t.startsWith('spawn_'))).toBe(false);
  });

  it('аннигиляция — только по миру, который бот ОСАЖДАЕТ и не может взять', () => {
    // Синергия с AI-BAL-7: размен «мир противника на мёртвый мир, богатый металлом» —
    // единственный способ, которым в матче вообще появляется `dead_world`.
    const s = rich(game2());
    const ravager = heroesOf(s, 'p2').find(
      (x) => (x.abilities ?? []).includes('annihilate'),
    )!;
    const target = homeOf(s, 'p1');
    const staged: GameState = {
      ...withHero(s, ravager.id, { alive: true, fleetId: 'f:siege', location: target }),
      diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' },
      fleets: {
        ...s.fleets,
        'f:siege': {
          id: 'f:siege',
          owner: 'p2',
          location: target,
          units: [{ unit: 'hero', count: 1 }],
          landing: [],
          traits: [],
          movement: null,
          orbit: 'near',
          bombarding: true,
        },
      },
    };
    const casts = payloads<{ heroId: string; abilityId: string; target?: string }>(
      orders(staged),
      'hero.ability',
    );
    const shot = casts.find((c) => data.heroAbilities[c.abilityId]!.type === 'annihilate');
    expect(shot).toBeDefined();
    expect(shot!.target).toBe(target);

    // …а тот же герой над тем же миром БЕЗ осады не стреляет: мир, который берут,
    // разрушать незачем.
    const notSieging: GameState = {
      ...staged,
      fleets: { ...staged.fleets, 'f:siege': { ...staged.fleets['f:siege']!, bombarding: false } },
    };
    expect(
      payloads<{ abilityId: string }>(orders(notSieging), 'hero.ability').some(
        (c) => data.heroAbilities[c.abilityId]!.type === 'annihilate',
      ),
    ).toBe(false);
  });

  it('ИГРОВОЙ бот способностей не кастует', () => {
    expect(only(orders(heroInBattle(rich(game2())), 'basic'), 'hero.ability')).toHaveLength(0);
  });
});

describe('AI-BAL-8 — инвариант #1 цел', () => {
  it('решение — чистая функция состояния: повтор даёт тот же набор приказов', () => {
    const s = rich(game2());
    const shape = (st: GameState): string =>
      JSON.stringify(orders(st).map((a) => [a.type, a.payload]));
    expect(shape(s)).toBe(shape(s));
  });

  it('поток ядра не двигается и ростер не мутируется', () => {
    const s = rich(game2());
    const rng = JSON.stringify(s.rng);
    const heroes = JSON.stringify(s.heroes);
    orders(s);
    expect(JSON.stringify(s.rng)).toBe(rng);
    expect(JSON.stringify(s.heroes)).toBe(heroes);
  });
});
