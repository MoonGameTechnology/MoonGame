/**
 * СОВМЕСТНЫЙ ШТУРМ (MSB-4) — приёмка кирпича.
 *
 * Решение владельца §0.0 №3: **у каждого штурмующего СВОЙ плацдарм** — `planet.beachheads`
 * стал списком. Решение §0.0 №4: **мир получает тот, кто начал штурм** — владелец ПЕРВОГО
 * плацдарма, а порядок списка это порядок высадки, поэтому «первый» читается прямо из
 * состояния, без подсчёта вклада.
 *
 * Отдельно покрыт край, которого вопрос владельца не касался и который в §0.0 №4 помечен
 * допущением: первый берег выбит, мир дожал второй — мир получает владелец самого раннего
 * ВЫЖИВШЕГО плацдарма. Отдать мир мёртвому значило бы отдать его тому, кого на земле уже
 * нет.
 */
import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { combatModule } from './combat';
import { diplomacyModule } from './diplomacy';
import {
  createInitialState,
  type Battle,
  type GameState,
  type Planet,
  type Player,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Гарнизон и десант одним корпусом: разница в исходе объясняется ПРАВИЛОМ, а не
    // составом. `guard` — заведомо непробиваемый, им проверяется «оба погибли».
    marine: { faction: 'x', domain: 'ground', stats: { attack: 10, defense: 4, speed: 1, hp: 20 } },
    guard: { faction: 'x', domain: 'ground', stats: { attack: 40, defense: 40, speed: 1, hp: 900 } },
    // Бьёт так же больно, как `guard` (горстка гибнет за раунд), но пробиваем: им
    // строится расклад «первый выбит, второй дожал».
    bastion: { faction: 'x', domain: 'ground', stats: { attack: 40, defense: 40, speed: 1, hp: 300 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const kernel = createKernel([combatModule, diplomacyModule]);
const ctx = (now: number): Context => ({ now, data });
const HOUR = 3_600_000;
const stacks = (list: Array<[string, number]>): UnitStack[] =>
  list.map(([unit, count]) => ({ unit, count }));

/**
 * Мир `P` хозяина `p0` под штурмом сразу нескольких плацдармов. Бой собирается прямо в
 * состоянии: доставка десанта — работа челноков (ROS-1.5), а этот кирпич про правила
 * наземного боя и про то, чей мир после него.
 */
function siege(
  garrison: Array<[string, number]>,
  landings: Array<[string, Array<[string, number]>]>,
): GameState {
  const s = createInitialState({ seed: 'msb4', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {
    p0: { id: 'p0', name: 'p0', faction: 'x', status: 'active', resources: {} },
  };
  const planet: Planet = {
    id: 'P',
    owner: 'p0',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: stacks(garrison),
    traits: [],
    beachheads: landings.map(([owner, units]) => ({ owner, units: stacks(units) })),
  };
  const sides: Battle['sides'] = landings.map(([owner]) => ({
    ref: { kind: 'beachhead' as const, planetId: 'P', owner },
    owner,
    role: 'attacker' as const,
  }));
  sides.push({ ref: { kind: 'garrison', planetId: 'P' }, owner: 'p0', role: 'defender' });
  const out: GameState = {
    ...s,
    players,
    planets: { P: planet },
    battles: { b1: { id: 'b1', location: 'P', phase: 'ground', sides, round: 0 } },
    scheduled: [{ id: 'evt:0', at: 0, type: 'combat.tick', payload: { battleId: 'b1' }, seq: 0 }],
    scheduleSeq: 1,
  };
  for (const [owner] of landings) {
    players[owner] = { id: owner, name: owner, faction: 'x', status: 'active', resources: {} };
    setStance(out, owner, 'p0', 'war');
  }
  // Штурмующие между собой НЕ воюют — иначе они перебьют друг друга вместо гарнизона, и
  // тест мерил бы не совместный штурм, а свалку.
  for (let i = 0; i < landings.length; i++) {
    for (let j = i + 1; j < landings.length; j++) {
      setStance(out, landings[i]![0], landings[j]![0], 'peace');
    }
  }
  return out;
}

function run(s: GameState, hours = 400): GameState {
  const r = kernel.advanceTo(s, ctx(hours * HOUR));
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r.state;
}

describe('MSB-4 — совместный штурм и чей мир', () => {
  it('ДВА ПЛАЦДАРМА — две отдельные стороны боя, а не одна слипшаяся', () => {
    const s = siege([['marine', 2]], [
      ['p1', [['marine', 2]]],
      ['p2', [['marine', 2]]],
    ]);
    const battle = s.battles.b1!;
    expect(battle.sides.filter((x) => x.ref.kind === 'beachhead')).toHaveLength(2);
    // Ссылка несёт ВЛАДЕЛЬЦА — без него оба плацдарма адресовались бы одним миром и
    // схлопнулись бы в одну сторону, а совместный штурм считался бы как одиночный.
    expect(battle.sides[0]!.ref).toEqual({ kind: 'beachhead', planetId: 'P', owner: 'p1' });
    expect(battle.sides[1]!.ref).toEqual({ kind: 'beachhead', planetId: 'P', owner: 'p2' });
  });

  it('ПЕРВЫЙ ДОЖАЛ САМ — мир его (§0.0 №4 «тому, кто начал штурм»)', () => {
    const after = run(siege([['marine', 1]], [
      ['p1', [['marine', 6]]],
      ['p2', [['marine', 6]]],
    ]));
    expect(after.planets.P?.owner).toBe('p1');
    expect(after.planets.P?.beachheads).toBeUndefined(); // поля после боя не остаётся
    expect(Object.keys(after.battles)).toEqual([]);
  });

  it('ПЕРВЫЙ ВЫБИТ, ДОЖАЛ ВТОРОЙ — мир у самого раннего ВЫЖИВШЕГО плацдарма', () => {
    // Расклад подобран так, чтобы p1 действительно пал ПЕРВЫМ, а не чтобы гарнизон
    // умер раньше него (с лёгким гарнизоном мир законно достаётся p1 — это проверяет
    // тест выше). `guard` живуч и бьёт больно: его ответ делится между двумя берегами,
    // горстки p1 хватает ровно на раунд, а p2 переживает обмен и дожимает мир.
    const after = run(siege([['bastion', 1]], [
      ['p1', [['marine', 1]]],
      ['p2', [['marine', 20]]],
    ]));
    expect(after.planets.P?.owner).toBe('p2');
    expect(after.planets.P?.beachheads).toBeUndefined();
  });

  it('ТРОФЕИ: победителей несколько — `battle.resolved` несёт их СПИСКОМ, а не молчит', () => {
    // Находка пересверки роадмапа: осколки начисляет `salvageFromEvents` по полю
    // `winner`, а оно есть, только когда выжил РОВНО ОДИН. При совместном штурме
    // гарнизон пал, а на земле стоят двое — `winner` честно null, и трофеи за
    // многосторонний бой просто перестали бы начисляться, не уронив ни одного теста.
    const s = siege([['marine', 1]], [
      ['p1', [['marine', 6]]],
      ['p2', [['marine', 6]]],
    ]);
    const r = kernel.advanceTo(s, ctx(400 * HOUR));
    if (!r.ok) throw new Error('advance failed');
    const resolved = r.events.filter((e) => e.type === 'battle.resolved');
    expect(resolved).toHaveLength(1);
    const p = resolved[0]!.payload as { winner?: unknown; winners?: unknown };
    expect(p.winner).toBeNull(); // выживших двое — единственного победителя нет
    expect(p.winners).toEqual(['p1', 'p2']);
  });

  it('ОБА ДЕСАНТА ПОГИБЛИ — мир остаётся хозяину, вечных чужих войск не завелось', () => {
    const after = run(siege([['guard', 3]], [
      ['p1', [['marine', 1]]],
      ['p2', [['marine', 1]]],
    ]));
    expect(after.planets.P?.owner).toBe('p0');
    expect(after.planets.P?.beachheads).toBeUndefined();
    expect(Object.keys(after.battles)).toEqual([]);
  });
});
