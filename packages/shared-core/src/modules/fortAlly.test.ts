/**
 * ФОРТ ПРИКРЫВАЕТ И СОЮЗНИКА (решение владельца 5, fortress-roadmap §0.6).
 *
 * «Форт — здание, которое строится на планетах, и оно даёт бонус к снижению получаемого
 * урона наземным СВОИМ И СОЮЗНЫМ войскам.»
 *
 * До этой правки хук выходил на `planet.owner !== a.defender`, то есть союзник,
 * обороняющий вашу планету, от вашего форта не получал НИЧЕГО. Расхождение тихое: ни один
 * тест его не видел, потому что все они проверяли владельца.
 *
 * Зонд гоняет `combat.damage` ровно так, как это делает бой (тот же приём, что в
 * `construction-extra.test.ts`): правило проверяется на самом конвейере, а не на пересказе.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { constructionModule } from './construction';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import { hookedDamage } from '../util/combat';
import type { Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: { fort: { name: 'Fort', cost: { metal: 1 }, buildTimeHours: 0, hp: 40, defenseBonus: 0.5 } },
  events: {},
});
const ctx = (): Context => ({ now: 0, data });

/** Зонд: прогоняет 100 урона через тот же ПРОИЗВОДИТЕЛЬ, которым пользуется бой.
 *  Звать `combat.damage` напрямую нельзя: снижение с PERK-2.1 живёт в отдельном пуле
 *  (`combat.mitigation`) и применяется производителем — проба мимо него не увидела бы
 *  форт вовсе. */
const probe: GameModule = {
  id: 'hook-probe',
  version: '1.0.0',
  setup(api) {
    api.onAction('probe.damage', (action, h) => {
      const args = action.payload as { phase: string; location: string; defender: string };
      h.emit('probe.result', {
        dmg: hookedDamage(h, 100, { ...args, attacker: null, battleId: undefined }),
      });
    });
  },
};
const kernel = createKernel([constructionModule, probe]);

const player = (id: string): Player => ({
  id, name: id, faction: 'x', status: 'active', resources: { metal: 100 },
});

/** Мир p1 с фортом; p2 — союзник, p3 — враг. */
function world(): GameState {
  const base = createInitialState({ seed: 'fortally', version: { data: '0.1.0', manifest: '1' } });
  const planet: Planet = {
    id: 'A', owner: 'p1', position: { x: 0, y: 0 }, resources: {},
    buildings: [{ type: 'fort', level: 1, hp: 40 }], garrison: [], traits: [],
  };
  const s: GameState = {
    ...base,
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    planets: { A: planet },
  };
  setStance(s, 'p1', 'p2', 'alliance');
  setStance(s, 'p1', 'p3', 'war');
  return s;
}

/** Сколько урона доедет до `defender` в наземной фазе на мире `A`. */
function damageTo(defender: string, s: GameState = world()): number {
  const r = kernel.applyAction(
    s,
    { id: 's:p1:1', type: 'probe.damage', playerId: 'p1', payload: { phase: 'ground', location: 'A', defender }, issuedAt: 0 },
    ctx(),
  );
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return (r.events.find((e) => e.type === 'probe.result')?.payload as { dmg: number }).dmg;
}

describe('FORT — форт прикрывает своих и союзных (решение владельца 5)', () => {
  // 100 / 1.5 = 66.67, затем −1% за одно стоящее здание.
  // Форт 0.5 + одно стоящее здание 0.01 — ОДИН пул очков, одно деление (PERK-2.1).
  // Раньше здесь было два независимых деления: `(100 / 1.5) * 0.99`.
  const PROTECTED = 100 / 1.51;

  it('ВЛАДЕЛЕЦ прикрыт — как и был', () => {
    expect(damageTo('p1')).toBeCloseTo(PROTECTED, 5);
  });

  it('СОЮЗНИК прикрыт ТАК ЖЕ — вот ради чего правка', () => {
    expect(damageTo('p2')).toBeCloseTo(PROTECTED, 5);
  });

  it('ВРАГ не прикрыт — иначе форт защищал бы штурмующего', () => {
    // Самая опасная форма ошибки: снять проверку целиком и прикрыть всех подряд. Тогда
    // форт работал бы НА ЗАХВАТЧИКА, стоящего на вашей же земле.
    expect(damageTo('p3')).toBe(100);
  });

  it('НЕЙТРАЛ (мир, не война, не союз) не прикрыт — союзник это именно alliance', () => {
    const s = world();
    setStance(s, 'p1', 'p3', 'peace');
    expect(damageTo('p3', s)).toBe(100);
  });

  it('на мире БЕЗ форта не прикрыт никто, включая союзника', () => {
    const s = world();
    s.planets.A!.buildings = [];
    expect(damageTo('p1', s)).toBe(100);
    expect(damageTo('p2', s)).toBe(100);
  });

  it('НИЧЕЙНЫЙ мир никого не прикрывает — союзничать не с кем', () => {
    const s = world();
    s.planets.A!.owner = null;
    expect(damageTo('p1', s)).toBe(100);
    expect(damageTo('p2', s)).toBe(100);
  });
});
