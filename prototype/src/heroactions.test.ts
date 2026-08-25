import { describe, it, expect } from 'vitest';
import {
  newGame,
  order,
  castHeroAbility,
  spawnHero,
  unlockHeroSkill,
  fitHero,
  data,
} from './game';
import type { GameState, Hero } from '@void/shared-core';

// Integration proof: the CORE hero engine (heroModule HERO-3..9) runs end-to-end against
// the prototype's inline catalogs + seeding. Core edge-cases live in shared-core's own
// hero.test.ts — here we only pin that the prototype wiring reaches each action.

function heroesOf(s: GameState, pid: string): Hero[] {
  return Object.values(s.heroes ?? {}).filter((h) => h.owner === pid);
}
const mainOf = (s: GameState, pid: string): Hero => heroesOf(s, pid).find((h) => h.fleetId)!;
const benched = (s: GameState, pid: string): Hero[] => heroesOf(s, pid).filter((h) => !h.fleetId);

/** Ближайший мир в радиусе коридора от корабля героя — цель для каста. */
function corridorTarget(s: GameState, hero: Hero): string {
  const origin = s.planets[s.fleets[hero.fleetId!]!.location!]!;
  return Object.values(s.planets).find(
    (p) =>
      p.id !== origin.id &&
      Math.hypot(p.position.x - origin.position.x, p.position.y - origin.position.y) <=
        (data.heroAbilities.corridor!.range ?? 0),
  )!.id;
}

describe('hero actions — the core engine over the prototype catalogs', () => {
  it('hero.spawn raises an undeployed roster hero at an owned world', () => {
    const s = newGame();
    const bench = benched(s, 'p1');
    expect(bench.length).toBeGreaterThan(0);
    const target = bench[0]!;
    const home = target.home!;
    const r = order(s, spawnHero('p1', target.id, home), s.time);
    expect(r.error).toBeUndefined();
    const raised = r.state.heroes![target.id]!;
    expect(raised.alive).toBe(true);
    expect(raised.fleetId).toBeTruthy();
    expect(r.state.fleets[raised.fleetId!]?.units.some((u) => u.unit === 'hero')).toBe(true);
  });

  it('«Коридор» заперт до узла дерева, а после него кастуется и уходит в кулдаун', () => {
    let s = newGame();
    s.players.p1!.resources = { ...s.players.p1!.resources, microelectronics: 9000, credits: 9000 };
    const main = mainOf(s, 'p1');
    // Заказ владельца: способности нет, пока не прокачан навык. Раньше она стояла в
    // стартовом ростере, и узел `overclocked_helm` выдавал то, что уже есть.
    expect(main.abilities).not.toContain('corridor');
    const near = corridorTarget(s, main);
    expect(order(s, castHeroAbility('p1', main.id, 'corridor', near), s.time).error).toBe(
      'E_NOT_EQUIPPED',
    );

    for (const node of ['neural_lace', 'overclocked_helm']) {
      const r = order(s, unlockHeroSkill('p1', main.id, node), s.time);
      expect(r.error).toBeUndefined();
      s = r.state;
    }
    expect(s.heroes![main.id]!.abilities).toContain('corridor'); // грант лёг в пустой слот

    const r = order(s, castHeroAbility('p1', main.id, 'corridor', near), s.time);
    expect(r.error).toBeUndefined();
    expect((r.state.tempLanes ?? []).length).toBe(1);
    expect(r.state.heroes![main.id]!.cooldowns?.path).toBeGreaterThan(s.time);
  });

  it('hero.ability casts scan (hero.effect.reveal) and stores a time-boxed fog reveal', () => {
    const s = newGame();
    const main = mainOf(s, 'p1');
    expect(main.abilities).toContain('scan'); // type `reveal` — now wired via heroEffects
    const origin = s.fleets[main.fleetId!]!.location!; // in-range target (the hero's own node)
    const r = order(s, castHeroAbility('p1', main.id, 'scan', origin), s.time);
    expect(r.error).toBeUndefined();
    const reveals = r.state.heroes![main.id]!.activeReveals ?? [];
    expect(reveals.length).toBe(1);
    expect(reveals[0]!.center).toBe(origin);
    expect(r.state.heroes![main.id]!.cooldowns?.['fx:reveal']).toBeGreaterThan(s.time);
  });

  it('hero.skill.unlock walks the branch tree and grants the node', () => {
    const s = newGame();
    const main = mainOf(s, 'p1'); // commander → transhuman
    const r1 = order(s, unlockHeroSkill('p1', main.id, 'neural_lace'), s.time);
    expect(r1.error).toBeUndefined();
    const h1 = r1.state.heroes![main.id]!;
    expect(h1.skills).toContain('neural_lace');
    expect(h1.passives).toContain('vanguard_impulse'); // the node's grant landed
    // wrong branch fails secure: a psionic node on a transhuman hero
    expect(order(s, unlockHeroSkill('p1', main.id, 'void_attunement'), s.time).error).toBe(
      'E_WRONG_BRANCH',
    );
  });

  it('лестница коридора доходит до игрока: узлы дерева поднимают ступень каста', () => {
    // HERO-CORRIDOR-СПЕКА: ступени 2 и 3 были недостижимы — ступень стояла числом в
    // каталоге, а поднять её было нечем. Теперь это узлы дерева навыков.
    let s = newGame();
    // Узлы стоят денег — казна пополнена, иначе тест мерил бы цену, а не лестницу.
    s.players.p1!.resources = { ...s.players.p1!.resources, microelectronics: 9000, credits: 9000 };
    const main = mainOf(s, 'p1'); // commander → transhuman
    const near = corridorTarget(s, main);
    const tierOfCast = (st: GameState): number => {
      const r = order(st, castHeroAbility('p1', main.id, 'corridor', near), st.time);
      expect(r.error).toBeUndefined();
      return r.state.tempLanes![0]!.tier!;
    };
    const unlock = (node: string): void => {
      const r = order(s, unlockHeroSkill('p1', main.id, node), s.time);
      expect(r.error).toBeUndefined();
      s = r.state;
    };

    unlock('neural_lace');
    unlock('overclocked_helm'); // сам коридор — тоже узел дерева
    expect(tierOfCast(s)).toBe(1); // одноразовый личный коридор

    unlock('corridor_sustained');
    expect(tierOfCast(s)).toBe(2); // со сроком жизни

    unlock('corridor_open');
    expect(tierOfCast(s)).toBe(3); // общий: проходят союзники — и все остальные заодно
  });

  it('hero.fit installs a fitting within the archetype slot budget', () => {
    const s = newGame();
    const main = mainOf(s, 'p1'); // commander: 4 slots
    const r = order(s, fitHero('p1', main.id, 'psi_amplifier'), s.time);
    expect(r.error).toBeUndefined();
    const h = r.state.heroes![main.id]!;
    expect(h.fittings).toContain('psi_amplifier');
    expect(h.abilities).toContain('scan'); // the fitting's ability grant landed
  });

  it('hero.ability recall (hero.effect.recall capability) warps a deployed ship home', () => {
    const s = newGame();
    // the ravager reserve (legendary «Разрушитель») carries recall — raise its ship first
    const rec = benched(s, 'p1').find((h) => (h.abilities ?? []).includes('recall'));
    expect(rec).toBeTruthy();
    const spawned = order(s, spawnHero('p1', rec!.id, rec!.home!), s.time);
    expect(spawned.error).toBeUndefined();
    const hero = spawned.state.heroes![rec!.id]!;
    const fleetId = hero.fleetId!;
    // pretend the ship travelled off to another node, then recall it (range-0, no target)
    const st = structuredClone(spawned.state);
    const away = Object.keys(st.planets).find((p) => p !== hero.home)!;
    st.fleets[fleetId]!.location = away;
    const r = order(st, castHeroAbility('p1', rec!.id, 'recall'), st.time);
    expect(r.error).toBeUndefined();
    expect(r.state.fleets[fleetId]?.location).toBe(hero.home); // warped back to the capital
    expect(r.state.heroes![rec!.id]?.cooldowns?.['fx:recall']).toBeGreaterThan(st.time);
  });

  it('hero.ability rally (hero.effect.aura capability) stores a live combat aura', () => {
    const s = newGame();
    const main = mainOf(s, 'p1'); // commander carries rally
    expect(main.abilities).toContain('rally');
    const r = order(s, castHeroAbility('p1', main.id, 'rally'), s.time); // range-0, no target
    expect(r.error).toBeUndefined();
    const auras = r.state.heroes![main.id]!.activeAuras;
    expect(auras?.length).toBe(1);
    expect(auras![0]!.bonus).toBe(0.1);
    expect(r.state.heroes![main.id]?.cooldowns?.['fx:aura']).toBeGreaterThan(s.time);
  });
});
