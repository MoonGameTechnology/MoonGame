/**
 * РАДИУС АУР ГЕРОЯ — ЛЕСТНИЦА ВМЕСТО ОДНОЙ СТУПЕНИ (HERO-AURA-R).
 *
 * Обе ауры (`rally`, `bulwark`) стояли с `radius: 300` и ПУСТОЙ лестницей `tiers`, то
 * есть выдавались сразу полностью прокачанными. По решению владельца старт опущен до
 * 1/16 карты, потолок — половина карты, между ними две ступени дерева навыков.
 *
 * Числа выбраны ОТ КАРТЫ, а не на глаз, и именно это здесь и сторожится: радиус,
 * не дотягивающий ни до одного соседа, и радиус, накрывающий их все, выглядят в JSON
 * одинаково безобидно. Тест держит три уровня раздельными на РЕАЛЬНЫХ картах, иначе
 * ступень, за которую игрок платит, может ничего не менять.
 */
import { describe, expect, it } from 'vitest';
import heroesJson from './heroes.json';
import {
  createInitialState,
  type Action,
  type ApplyResult,
  type Context,
  type Fleet,
  type GameState,
  type Hero,
  type Planet,
  type Player,
  createKernel,
  heroModule,
  heroEffectsModule,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';
import skirmish from './maps/skirmish-1.json';
import avaDuel from './maps/ava-duel-1.json';
import ava2v2 from './maps/ava-2v2-1.json';
import pve from './maps/pve-1.json';

const data = shippedGameData();

/** Числа решения владельца — здесь они ПРИБИТЫ: правка каталога обязана осознанно
 *  пройти через этот тест, а не проехать мимо. */
const BASE = 42;
const RELAY = 220;
const GRID = 334;

/** Та же лестница, но ПРОЧИТАННАЯ ИЗ КАТАЛОГА. Сверка с картами ниже меряет именно её:
 *  сверяй она константы выше — правка JSON прошла бы мимо проверки на мёртвую ступень,
 *  ради которой сверка и существует. */
const ladder = ((): [number, number, number] => {
  const def = data.heroAbilities.rally!;
  const [first, second] = def.tiers;
  return [
    def.params.radius as number,
    first!.params.radius as number,
    second!.params.radius as number,
  ];
})();

const auras = ['rally', 'bulwark'] as const;

describe('лестница радиуса аур — каталог (HERO-AURA-R)', () => {
  it.each(auras)('у ауры «%s» три уровня радиуса, и они растут', (id) => {
    const def = data.heroAbilities[id]!;
    expect(def.params.radius).toBe(BASE);
    expect(def.tiers.map((s) => [s.skill, s.params.radius])).toEqual([
      ['command_relay', RELAY],
      ['command_grid', GRID],
    ]);
  });

  it('узлы лестницы существуют и идут один за другим', () => {
    const relay = data.heroSkillTrees.command_relay!;
    const grid = data.heroSkillTrees.command_grid!;
    expect(relay.requires).toEqual([]);
    expect(grid.requires).toEqual(['command_relay']);
  });

  it('узлы ОБЩИЕ — иначе «Бастион» прокачал бы не всякий, кто им владеет', () => {
    // `bulwark` есть у `commander` (transhuman) и у `warden` (psionic). Узел с веткой
    // был бы одному из них запрещён (`E_WRONG_BRANCH`), и половина владельцев ауры
    // осталась бы без прокачки — при том что в каталоге всё выглядело бы правильно.
    //
    // Ветки припаркованы (HERO-11): в ЗАГРУЖЕННОМ каталоге их нет, поэтому владельцев
    // ауры здесь разводит не `def.branch`, а `parkedBranch` из сырого JSON. Так проверка
    // переживает парковку: сегодня она подтверждает, что узлы общие и без всякой ветки,
    // а в день распарковки снова ловит ровно тот дефект, ради которого написана.
    const owners = Object.entries(heroesJson as Record<string, { startAbilities?: string[]; parkedBranch?: string }>)
      .filter(([, def]) => def.startAbilities?.includes('bulwark'))
      .map(([, def]) => def.parkedBranch);
    expect(new Set(owners).size).toBeGreaterThan(1);
    expect(data.heroSkillTrees.command_relay!.branch).toBeUndefined();
    expect(data.heroSkillTrees.command_grid!.branch).toBeUndefined();
  });
});

/** Расстояния между узлами карты — то, обо что радиус и меряется. */
function spans(map: {
  sectors: Record<string, { position?: { x: number; y: number } }>;
}): number[] {
  const pts = Object.values(map.sectors)
    .map((s) => s.position)
    .filter((p): p is { x: number; y: number } => p !== undefined);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      out.push(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
    }
  }
  return out.sort((a, b) => a - b);
}

const maps = {
  'skirmish-1': skirmish,
  'ava-duel-1': avaDuel,
  'ava-2v2-1': ava2v2,
  'pve-1': pve,
};

/** Сколько ПАР узлов карты попадает в круг радиуса `r`. */
const reach = (map: Parameters<typeof spans>[0], r: number): number =>
  spans(map).filter((d) => d <= r).length;

describe('лестница радиуса аур — сверка с картами (HERO-AURA-R)', () => {
  it.each(Object.entries(maps))('на карте %s каждая ступень даёт БОЛЬШЕ прошлой', (_id, map) => {
    // Главная проверка кирпича: ступень, за которую игрок платит, обязана что-то менять.
    // В JSON мёртвая ступень выглядит ровно так же, как живая, — видно её только здесь.
    const [base, relay, grid] = ladder;
    // База не достаёт ни до одного соседа: аура работает в том бою, где герой сам стоит.
    expect(reach(map, base)).toBe(0);
    expect(reach(map, relay)).toBeGreaterThan(0);
    expect(reach(map, grid)).toBeGreaterThan(reach(map, relay));
  });

  it('на большой карте покрытие МЕНЬШЕ — радиус абсолютный, и это замысел', () => {
    // Решение владельца: радиус не растёт вместе с картой. На просторной `pve-1` полный
    // радиус не достаёт даже до типичного соседа — герою приходится выбирать, где стоять,
    // и именно этого от абсолютного радиуса и ждут.
    const p = spans(pve);
    expect(ladder[2]).toBeLessThan(p[Math.floor(p.length / 2)]!);
  });
});

const HOUR = 3_600_000;
const ctx = (now = 0): Context => ({ now, data });
const act = (type: string, payload: unknown, seq = 1): Action => ({
  id: `s:p1:${seq}`,
  type,
  playerId: 'p1',
  payload,
  issuedAt: 0,
});
function ok(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}

const kernel = createKernel([heroModule, heroEffectsModule]);

function world(skills: string[] = []): GameState {
  const s = createInitialState({ seed: 'aura', version: { data: data.version, manifest: '1' } });
  const at = (id: string, x: number): Planet => ({
    id,
    owner: 'p1',
    position: { x, y: 0 },
    links: [],
    kind: 'planet',
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  });
  const fleet: Fleet = {
    id: 'f1',
    owner: 'p1',
    location: 'H',
    movement: null,
    units: [{ unit: 'hero', count: 1 }],
    traits: [],
  };
  const hero: Hero = {
    id: 'hero:p1:1',
    owner: 'p1',
    archetype: 'commander',
    location: 'H',
    home: 'H',
    cooldowns: {},
    alive: true,
    fleetId: 'f1',
    abilities: ['rally'],
    ...(skills.length > 0 ? { skills } : {}),
  };
  const player: Player = {
    id: 'p1',
    name: 'p1',
    faction: 'x',
    status: 'active',
    resources: { credits: 5000, metal: 5000 },
    technologies: { completed: [] },
  };
  return {
    ...s,
    players: { p1: player },
    planets: { H: at('H', 0) },
    fleets: { f1: fleet },
    heroes: { 'hero:p1:1': hero },
  };
}

/** Радиус ауры, которую герой РЕАЛЬНО поставил (событие `hero.aura`). */
function castRadius(state: GameState, now = 0): number {
  const cast = act('hero.ability', { heroId: 'hero:p1:1', abilityId: 'rally' }, 9);
  const r = ok(kernel.applyAction(state, cast, ctx(now)));
  const ev = r.events.find((e) => e.type === 'hero.aura');
  return (ev?.payload as { radius: number }).radius;
}

describe('лестница радиуса аур — поведение на шипнутом каталоге (HERO-AURA-R)', () => {
  it('без навыков аура ставится базовым радиусом', () => {
    expect(castRadius(world())).toBe(BASE);
  });

  it('каждый открытый узел РАСШИРЯЕТ поставленную ауру', () => {
    expect(castRadius(world(['command_relay']))).toBe(RELAY);
    expect(castRadius(world(['command_relay', 'command_grid']))).toBe(GRID);
  });

  it('узлы покупаются штатным действием — ветка не мешает, казна платит', () => {
    let st = world();
    const relay = ok(
      kernel.applyAction(
        st,
        act('hero.skill.unlock', { heroId: 'hero:p1:1', node: 'command_relay' }, 1),
        ctx(),
      ),
    );
    st = relay.state;
    const grid = ok(
      kernel.applyAction(
        st,
        act('hero.skill.unlock', { heroId: 'hero:p1:1', node: 'command_grid' }, 2),
        ctx(HOUR),
      ),
    );
    expect(grid.state.heroes!['hero:p1:1']?.skills).toEqual(['command_relay', 'command_grid']);
    // И купленное сразу видно в ауре — лестница читается из данных, а не из копии.
    expect(castRadius(grid.state, HOUR)).toBe(GRID);
  });
});
