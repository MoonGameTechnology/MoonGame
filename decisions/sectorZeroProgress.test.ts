import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveState, pveModeId } from '../packages/client/src/gameData';
import { effectiveStats } from '../packages/shared-core/src/index';
import type { GameState } from '../packages/shared-core/src/index';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  prepareSectorZeroRun,
  settleSectorZeroRun,
  sectorHeroSlots,
  WARRANTS_PER_REWARD,
  type SectorZeroProgress,
  type SectorProgressAction,
} from './sectorZeroProgress';
import { parseRunSave, serializeRunSave, RUN_SAVE_VERSION } from './runSave';

const data = shippedGameData();
const fresh = () => freshSectorZeroProgress(data);
function change(p: SectorZeroProgress, action: SectorProgressAction): SectorZeroProgress {
  const result = changeSectorZeroProgress(p, action, data);
  expect(result).not.toBeNull();
  return result!;
}

describe('Sector Zero persistent preparation', () => {
  it('can fit a real starter module without spending or borrowing PvP progress', () => {
    const p = fresh();
    const fitted = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    expect(fitted.loadouts.cruiser).toEqual(['ion_engine']);
    expect(fitted.research).toBe(0);
    expect(p.loadouts).toEqual({});
    expect(
      changeSectorZeroProgress(p, { kind: 'unlock-module', id: 'shield_booster' }, data),
    ).toBeNull();
  });

  it('respects ownership, hull restrictions, slot capacity and unequipping', () => {
    let p = { ...fresh(), research: 20 };
    p = change(p, { kind: 'unlock-module', id: 'radar_module' });
    expect(
      changeSectorZeroProgress(p, { kind: 'fit', hull: 'cruiser', id: 'radar_module' }, data),
    ).toBeNull();
    p = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    expect(
      changeSectorZeroProgress(p, { kind: 'fit', hull: 'cruiser', id: 'cargo_bay' }, data),
    ).toBeNull();
    p = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    p = change(p, { kind: 'fit', hull: 'cruiser', id: 'cargo_bay' });
    expect(p.loadouts.cruiser).toEqual(['cargo_bay']);
  });

  it('persists a hero upgrade and skill chain, rejecting wrong branches and missing prerequisites', () => {
    let p = { ...fresh(), research: 40 };
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'skill', hero: 'commander', id: 'corridor_sustained' },
        data,
      ),
    ).toBeNull();
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'skill', hero: 'commander', id: 'void_attunement' },
        data,
      ),
    ).toBeNull();
    p = change(p, { kind: 'upgrade-hero', id: 'commander' });
    p = change(p, { kind: 'skill', hero: 'commander', id: 'neural_lace' });
    p = change(p, { kind: 'skill', hero: 'commander', id: 'overclocked_helm' });
    p = change(p, { kind: 'skill', hero: 'commander', id: 'corridor_sustained' });
    p = change(p, { kind: 'ability', hero: 'commander', id: 'corridor' });
    const roundtrip = parseSectorZeroProgress(JSON.stringify(p), data);
    expect(roundtrip).toEqual(p);
    expect(sectorHeroSlots(roundtrip.heroes.commander!, data)).toBe(2);
    expect(
      changeSectorZeroProgress(p, { kind: 'ability', hero: 'commander', id: 'scan' }, data),
    ).toBeNull();
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'skill', hero: 'commander', id: 'overclocked_helm' },
        data,
      ),
    ).toBeNull();
  });

  it('chooses another acquired hero and carries their own skills into the real map', () => {
    let p = { ...fresh(), research: 30 };
    p = change(p, { kind: 'unlock-hero', id: 'warden' });
    p = change(p, { kind: 'select-hero', id: 'warden' });
    p = change(p, { kind: 'skill', hero: 'warden', id: 'void_attunement' });
    const s = prepareSectorZeroRun(pveState(data), p, data);
    const own = Object.values(s.heroes ?? {}).filter((h) => h.owner === 'p1');
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      archetype: 'warden',
      skills: ['void_attunement'],
      passives: ['rally_beacon'],
      equipped: ['bulwark'],
      alive: true,
    });
    expect(s.fleets[own[0]!.fleetId!]?.owner).toBe('p1');
  });

  it('applies ship sets to the next attempt only, without altering the Swarm or an existing save', () => {
    const base = pveState(data);
    const p = change(fresh(), { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    const s = prepareSectorZeroRun(base, p, data);
    const cruiser = s.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!;
    expect(effectiveStats(data.units.cruiser!, cruiser, data).speed).toBeGreaterThan(
      data.units.cruiser!.stats.speed,
    );
    expect(base.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!.modules).toBeUndefined();
    expect(s.fleets.p3_1).toEqual(base.fleets.p3_1);
    const save = serializeRunSave({
      v: RUN_SAVE_VERSION,
      mode: pveModeId()!,
      difficulty: 'strong',
      state: s,
      sectorZeroAttempt: 1,
      shipLoadouts: p.loadouts,
    });
    const later = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    expect(later.loadouts.cruiser).toEqual([]);
    expect(parseRunSave(save)).toMatchObject({
      difficulty: 'strong',
      sectorZeroAttempt: 1,
      shipLoadouts: { cruiser: ['ion_engine'] },
    });
  });

  it('rewards a terminal loss once, survives reload, and does not reward a menu exit', () => {
    const p = { ...fresh(), nextAttempt: 2 };
    const s = pveState(data);
    expect(settleSectorZeroRun(p, 1, s)).toBe(p);
    s.pve = { waveNumber: 4, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p3';
    const settled = settleSectorZeroRun(p, 1, s);
    expect(settled.research).toBe(5);
    const loaded = parseSectorZeroProgress(JSON.stringify(settled), data);
    expect(settleSectorZeroRun(loaded, 1, s)).toBe(loaded);
    s.match.winner = 'p1';
    expect(settleSectorZeroRun(p, 1, s).research).toBeGreaterThan(settled.research);
  });

  it('does not confuse two different attempts ending at the same game time', () => {
    const s = pveState(data);
    s.pve = { waveNumber: 2, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p3';
    const first = settleSectorZeroRun({ ...fresh(), nextAttempt: 2 }, 1, s);
    const second = settleSectorZeroRun({ ...first, nextAttempt: 3 }, 2, s);
    expect(second.research).toBe(first.research * 2);
  });

  it('repairs invalid progress without granting unknown skills or impossible sets', () => {
    expect(parseSectorZeroProgress('{broken', data)).toEqual(fresh());
    const p = parseSectorZeroProgress(
      JSON.stringify({
        ...fresh(),
        research: -100,
        selectedHero: 'ghost',
        heroes: {
          commander: {
            level: 100,
            skills: ['corridor_open', 'ghost'],
            equipped: ['ghost', 'rally', 'rally'],
          },
        },
        loadouts: { cruiser: ['ion_engine', 'ion_engine', 'cargo_bay', 'ghost'] },
      }),
      data,
    );
    expect(p.research).toBe(0);
    expect(p.heroes.commander).toEqual({ level: 3, skills: [], equipped: ['rally'] });
    expect(p.loadouts.cruiser).toEqual(['ion_engine']);
  });
});

describe('SZE-1.1 — звёздность модуля: профиль, потолок, снимок в забег', () => {
  const cap = data.sectorZeroStars.cap;

  it('свежий профиль звёзд не имеет, а потолок берётся из данных', () => {
    expect(fresh().stars).toEqual({});
    expect(cap).toBeGreaterThan(0);
  });

  it('разбор профиля срезает звёзды по потолку и чинит мусор', () => {
    // Профиль лежит в localStorage — то есть правится игроком. Больше потолка,
    // дробное, отрицательное и звезда несуществующего модуля не должны доехать.
    const raw = JSON.stringify({
      ...fresh(),
      stars: { cargo_bay: cap + 7, ion_engine: -3, radar_module: 1.5, ghost_module: 2 },
    });
    const p = parseSectorZeroProgress(raw, data);
    expect(p.stars.cargo_bay).toBe(cap);
    expect(p.stars.ion_engine).toBeUndefined();
    expect(p.stars.radar_module).toBeUndefined();
    expect(p.stars.ghost_module).toBeUndefined();
  });

  it('звезда доезжает в забег снимком: и на корабли, и в арсенал места', () => {
    const p = { ...change(fresh(), { kind: 'fit', hull: 'cruiser', id: 'ion_engine' }) };
    p.stars = { ion_engine: 2 };
    const s = prepareSectorZeroRun(pveState(data), p, data);
    const cruiser = s.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!;
    expect(cruiser.moduleStars).toEqual({ ion_engine: 2 });
    // Арсенал — источник для того, что ПОСТРОЯТ в забеге: без него верфь выдавала бы
    // ★0, пока стартовый флот летает на ★2, и игрок видел бы два разных модуля.
    expect(s.players.p1?.arsenal?.stars).toEqual({ ion_engine: 2 });
    const bare = prepareSectorZeroRun(pveState(data), { ...p, stars: {} }, data);
    expect(bare.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!.moduleStars).toBeUndefined();
  });

  it('звезда МЕНЯЕТ ЧИСЛА модуля в матче', () => {
    const p = { ...change(fresh(), { kind: 'fit', hull: 'cruiser', id: 'ion_engine' }) };
    const plain = prepareSectorZeroRun(pveState(data), p, data);
    const starred = prepareSectorZeroRun(pveState(data), { ...p, stars: { ion_engine: cap } }, data);
    const speedOf = (s: typeof plain): number =>
      effectiveStats(
        data.units.cruiser!,
        s.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!,
        data,
      ).speed!;
    expect(speedOf(starred)).toBeGreaterThan(speedOf(plain));
  });

  it('ЛОВУШКА HPR-3.3: заточка во время идущего забега забег не меняет', () => {
    // Мета читается РОВНО ОДИН раз — на старте. Иначе реплей уже сыгранного забега
    // перестал бы воспроизводиться, как только игрок заточит тот же модуль.
    const p = { ...change(fresh(), { kind: 'fit', hull: 'cruiser', id: 'ion_engine' }) };
    p.stars = { ion_engine: 1 };
    const running = prepareSectorZeroRun(pveState(data), p, data);
    const before = JSON.parse(JSON.stringify(running)) as unknown;
    p.stars = { ion_engine: cap }; // игрок ушёл в Мастерскую и получил звезду
    expect(running).toEqual(before);
    expect(running.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!.moduleStars).toEqual({
      ion_engine: 1,
    });
  });

  it('сохранённый забег возвращается со СВОИМИ звёздами, а не с нынешними', () => {
    const p = { ...change(fresh(), { kind: 'fit', hull: 'cruiser', id: 'ion_engine' }) };
    p.stars = { ion_engine: 1 };
    const s = prepareSectorZeroRun(pveState(data), p, data);
    const save = serializeRunSave({
      v: RUN_SAVE_VERSION,
      mode: pveModeId()!,
      difficulty: 'strong',
      state: s,
      sectorZeroAttempt: 1,
      shipLoadouts: p.loadouts,
    });
    p.stars = { ion_engine: cap };
    const restored = parseRunSave(save) as { state: GameState } | null;
    expect(
      restored?.state.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')?.moduleStars,
    ).toEqual({ ion_engine: 1 });
  });
});

describe('SZE-1.2 — Мастерская: кошелёк, попытка, инвариант провала', () => {
  const ladder = data.sectorZeroStars;
  const seeded = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
    ...freshSectorZeroProgress(data, 'profile-7'),
    warrants: 9999,
    ...over,
  });

  it('свежий профиль: кошелёк пуст, попыток нет', () => {
    const p = freshSectorZeroProgress(data, 'profile-7');
    expect([p.warrants, p.forgeTries, p.seed]).toEqual([0, {}, 'profile-7']);
  });

  it('забег — кран Варрантов, а не только данных', () => {
    // §2 роадмапа экономики: вторая половина награды за забег. Без крана Мастерская
    // недостижима: нажать в ней нечего.
    const s = pveState(data);
    s.pve = { waveNumber: 4, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p1';
    const after = settleSectorZeroRun({ ...seeded({ warrants: 0 }), nextAttempt: 2 }, 1, s);
    expect(after.research).toBe(8); // 1 + 4 волны + 3 за победу
    expect(after.warrants).toBe(8 * WARRANTS_PER_REWARD);
  });

  it('гарантированная ступень поднимает звезду и списывает Варранты', () => {
    const p = seeded();
    const next = change(p, { kind: 'forge', id: 'cargo_bay' });
    expect(next.stars.cargo_bay).toBe(1);
    expect(next.warrants).toBe(p.warrants - ladder.steps[0]!.warrants);
    expect(next.forgeTries.cargo_bay).toBe(1);
  });

  it('ПРОВАЛ сжигает Варранты, но звёздность не трогает', () => {
    // Инвариант владельца 2026-09-20: страховать нечего, потому что терять нечего.
    let p = seeded({ stars: { cargo_bay: ladder.cap - 1 } });
    let failures = 0;
    for (let i = 0; i < 40 && failures === 0; i++) {
      const before = p;
      p = change(p, { kind: 'forge', id: 'cargo_bay' });
      if (p.stars.cargo_bay === before.stars.cargo_bay) {
        failures++;
        expect(p.warrants).toBeLessThan(before.warrants);
        expect(p.forgeTries.cargo_bay).toBe((before.forgeTries.cargo_bay ?? 0) + 1);
      }
    }
    expect(failures).toBe(1); // верхняя ступень обязана иногда не удаваться
  });

  it('перезагрузка не перекатывает: тот же профиль даёт тот же исход', () => {
    const p = seeded({ stars: { cargo_bay: ladder.cap - 1 } });
    expect(change(p, { kind: 'forge', id: 'cargo_bay' })).toEqual(
      change(p, { kind: 'forge', id: 'cargo_bay' }),
    );
  });

  it('счётчик попыток ПОИМЕННЫЙ — чужой попыткой свой бросок не сдвинуть', () => {
    // Иначе открывался бы эксплойт: жечь дешёвые попытки на дешёвом модуле, пока
    // счётчик не встанет на удачный номер для дорогого. Поимённый счётчик делает
    // подкрутку ровно такой же дорогой, как сама попытка.
    const base = seeded({ stars: { cargo_bay: ladder.cap - 1 } });
    const direct = change(base, { kind: 'forge', id: 'cargo_bay' });
    const afterOther = change(base, { kind: 'forge', id: 'ion_engine' });
    const indirect = change(
      { ...afterOther, warrants: base.warrants, stars: base.stars },
      { kind: 'forge', id: 'cargo_bay' },
    );
    expect(indirect.stars.cargo_bay).toBe(direct.stars.cargo_bay);
  });

  it('на потолке, без денег и на чужом модуле попытка не проходит', () => {
    const at = seeded({ stars: { cargo_bay: ladder.cap } });
    expect(changeSectorZeroProgress(at, { kind: 'forge', id: 'cargo_bay' }, data)).toBeNull();
    expect(
      changeSectorZeroProgress(seeded({ warrants: 0 }), { kind: 'forge', id: 'cargo_bay' }, data),
    ).toBeNull();
    expect(
      changeSectorZeroProgress(seeded(), { kind: 'forge', id: 'shield_booster' }, data),
    ).toBeNull(); // не открыт
    expect(changeSectorZeroProgress(seeded(), { kind: 'forge', id: 'ghost' }, data)).toBeNull();
  });

  it('разбор профиля чинит кошелёк и счётчики', () => {
    const raw = JSON.stringify({
      ...freshSectorZeroProgress(data, 'profile-7'),
      warrants: -5,
      forgeTries: { cargo_bay: 2.5, ion_engine: -1, ghost: 3, radar_module: 4 },
    });
    const p = parseSectorZeroProgress(raw, data);
    expect(p.warrants).toBe(0);
    expect(p.forgeTries).toEqual({ radar_module: 4 });
  });
});
