import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveState, pveModeId } from '../packages/client/src/gameData';
import { effectiveStats, hashState } from '../packages/shared-core/src/index';
import type { GameState } from '../packages/shared-core/src/index';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  prepareSectorZeroRun,
  settleSectorZeroRun,
  sectorHeroSlots,
  sectorHullIds,
  sectorModuleIds,
  sectorSkillOpenTo,
  sovereignRepairCost,
  WARRANTS_PER_REWARD,
  type SectorZeroProgress,
  type SectorProgressAction,
} from './sectorZeroProgress';
import { parseRunSave, serializeRunSave, RUN_SAVE_VERSION } from './runSave';
import { runLoot } from './moduleRarity';

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
    // Радар — роль дозорного фрегата (решение владельца 2026-09-23): на него встаёт.
    expect(
      change(p, { kind: 'fit', hull: 'picket_frigate', id: 'radar_module' }).loadouts
        .picket_frigate,
    ).toEqual(['radar_module']);
    p = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    expect(
      changeSectorZeroProgress(p, { kind: 'fit', hull: 'cruiser', id: 'cargo_bay' }, data),
    ).toBeNull();
    p = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    p = change(p, { kind: 'fit', hull: 'cruiser', id: 'cargo_bay' });
    expect(p.loadouts.cruiser).toEqual(['cargo_bay']);
  });

  it('persists a hero upgrade and skill chain, rejecting missing prerequisites', () => {
    let p = { ...fresh(), research: 40 };
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'skill', hero: 'commander', id: 'corridor_sustained' },
        data,
      ),
    ).toBeNull();
    // Раньше здесь же проверялась ЧУЖАЯ ветка: `void_attunement` (psionic) на
    // `commander` (transhuman) не покупался. Ветки припаркованы (HERO-11) — чужих узлов
    // в каталоге больше нет. Проверяем, что корень без `requires` покупается, а всё, что
    // ниже по лестнице, по-прежнему закрыто родителями (выше). Корень — `wreck_rig`:
    // `void_attunement` Командиру не продаётся вовсе, его «Маяк сбора» у героя со старта
    // (AUD-22, `sectorZeroSkillNodes.test.ts`).
    expect(
      changeSectorZeroProgress(p, { kind: 'skill', hero: 'commander', id: 'wreck_rig' }, data),
    ).not.toBeNull();
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

  it('общий узел покупается в подготовке — правило ветки то же, что в ядре', () => {
    // Сторож над расхождением, которое парковка веток (HERO-11) СКРЫЛА бы: здесь стояло
    // строгое равенство `node.branch === def.branch`, и безветочный узел
    // (`undefined !== 'transhuman'`) в подготовке не покупался, хотя ядро на настоящей
    // карте его пускало — восемь узлов из девятнадцати, треть дерева.
    //
    // Пока ветки припаркованы, обе стороны `undefined`, и строгое равенство случайно
    // даёт верный ответ, поэтому проверять надо на каталоге С ВЕТКАМИ — иначе тест
    // молчал бы ровно до дня распарковки. Каталог здесь распаркован вручную.
    const unparked = {
      ...data,
      heroes: { ...data.heroes, commander: { ...data.heroes.commander!, branch: 'transhuman' as const } },
      heroSkillTrees: {
        ...data.heroSkillTrees,
        // общий узел без ветки, без родителей — ядро пускает такой любому герою
        command_relay: { ...data.heroSkillTrees.command_relay!, branch: undefined },
        // чужой узел — по-прежнему закрыт
        void_attunement: { ...data.heroSkillTrees.void_attunement!, branch: 'psionic' as const },
      },
    };
    const p = { ...fresh(), research: 40 };
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'skill', hero: 'commander', id: 'command_relay' },
        unparked,
      ),
    ).not.toBeNull();
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'skill', hero: 'commander', id: 'void_attunement' },
        unparked,
      ),
    ).toBeNull();
    // Академия раскладывает дерево тем же правилом (ревью Sector Zero): общий узел виден
    // любому герою, чужой — нет. Иначе купить можно было бы то, чего на экране нет.
    const trees = unparked.heroSkillTrees;
    expect(sectorSkillOpenTo(trees.command_relay!, 'commander', unparked)).toBe(true);
    expect(sectorSkillOpenTo(trees.void_attunement!, 'commander', unparked)).toBe(false);
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

  it('досье Роя пополняется на итогах забега и переживает сохранение (заказ владельца 2026-09-24)', () => {
    const p = { ...fresh(), nextAttempt: 2 };
    const s = pveState(data);
    s.pve = { waveNumber: 4, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p3';
    s.swarmIntel = {
      p1: { a: { owner: 'swarm', location: 'x', at: 1, units: [{ unit: 'swarm_brood_mother', count: 1 }] } },
    };
    // Без каталога игры досье не трогается — выплата от него не зависит.
    expect(settleSectorZeroRun(p, 1, s).swarmCodex).toEqual(p.swarmCodex);
    const settled = settleSectorZeroRun(p, 1, s, undefined, data);
    expect(settled.swarmCodex.units.swarm_brood_mother).toEqual({ max: 1, runs: 1 });
    const loaded = parseSectorZeroProgress(JSON.stringify(settled), data);
    expect(loaded.swarmCodex).toEqual(settled.swarmCodex);
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

  it('ЗАДАЧИ КАРТЫ добавляют к выплате, а не заменяют её (PVR-5.2)', () => {
    // Надбавка складывается с выплатой за волны намеренно: иначе игрок, сделавший задачи
    // и проигравший рано, получил бы больше дошедшего до конца, и «дополнительная»
    // задача перестала бы быть дополнительной.
    const s = pveState(data);
    s.pve = { waveNumber: 4, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p3';
    const base = settleSectorZeroRun({ ...fresh(), nextAttempt: 2 }, 1, s).research;

    // Задача, которая на этом состоянии ЗАВЕДОМО выполнена: снести то, чего на карте нет.
    const done = { id: 'mission.x', kind: 'raze' as const, targets: ['no_such_building'], reward: 5 };
    const withBonus = settleSectorZeroRun({ ...fresh(), nextAttempt: 2 }, 1, s, { id: 'ch', objectives: [done] }).research;
    expect(withBonus).toBe(base + 5);

    // Контроль: НЕвыполненная задача не платит, и выплата остаётся прежней.
    const notDone = { id: 'mission.y', kind: 'control' as const, targets: ['no_such_planet'], reward: 5 };
    expect(settleSectorZeroRun({ ...fresh(), nextAttempt: 2 }, 1, s, { id: 'ch', objectives: [notDone] }).research).toBe(base);

    // И контроль формы: пустой список задач — ровно прежнее поведение.
    expect(settleSectorZeroRun({ ...fresh(), nextAttempt: 2 }, 1, s, { id: 'ch', objectives: [] }).research).toBe(base);
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
  // Здесь проверяется ЛЕСТНИЦА целиком, поэтому модуль поднят до легендарного: с
  // SZE-5.2 потолок звёзд зависит от редкости, и только у легендарного он равен общему.
  const seeded = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
    ...freshSectorZeroProgress(data, 'profile-7'),
    warrants: 9999,
    moduleRarity: { cargo_bay: 'legendary' },
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

describe('SZE-1.3 — осколки: серия неудач упирается в гарантию', () => {
  const ladder = data.sectorZeroStars;
  const top = ladder.cap - 1; // верхняя ступень: самый длинный хвост неудач
  // Легендарные — чтобы потолок редкости (SZE-5.2) совпал с общим и верхняя ступень была доступна.
  const seeded = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
    ...freshSectorZeroProgress(data, 'profile-7'),
    warrants: 999999,
    moduleRarity: { cargo_bay: 'legendary', ion_engine: 'legendary' },
    ...over,
  });

  it('свежий профиль осколков не имеет', () => {
    expect(freshSectorZeroProgress(data, 'x').forgeShards).toEqual({});
  });

  it('неудача копит осколок, успех его обнуляет', () => {
    let p = seeded({ stars: { cargo_bay: top } });
    const burned: number[] = [];
    while ((p.stars.cargo_bay ?? 0) === top) {
      p = change(p, { kind: 'forge', id: 'cargo_bay' });
      burned.push(p.forgeShards.cargo_bay ?? 0);
    }
    expect(burned.slice(0, -1)).toEqual(burned.slice(0, -1).map((_, i) => i + 1));
    expect(p.forgeShards.cargo_bay).toBeUndefined(); // звезда взята — гарантия отработана
  });

  it('серия неудач ГАРАНТИРОВАННО приводит к звезде, а не в бесконечность', () => {
    // Это и есть смысл кирпича: без потолка попыток игрок может лить Варранты без предела.
    const pity = ladder.steps[top]!.pity ?? 0;
    expect(pity).toBeGreaterThan(0);
    let p = seeded({ stars: { cargo_bay: top } });
    let spent = 0;
    while ((p.stars.cargo_bay ?? 0) === top) {
      p = change(p, { kind: 'forge', id: 'cargo_bay' });
      spent++;
    }
    expect(p.stars.cargo_bay).toBe(ladder.cap);
    expect(spent).toBeLessThanOrEqual(pity); // потолок попыток, а не «когда-нибудь повезёт»
  });

  it('осколки поимённые: чужие неудачи чужую гарантию не приближают', () => {
    let p = seeded({ stars: { cargo_bay: top, ion_engine: top } });
    p = change(p, { kind: 'forge', id: 'ion_engine' });
    expect(p.forgeShards.cargo_bay).toBeUndefined();
  });

  it('разбор профиля чинит осколки', () => {
    const raw = JSON.stringify({
      ...freshSectorZeroProgress(data, 'x'),
      forgeShards: { cargo_bay: -2, ion_engine: 1.5, ghost: 3, radar_module: 2 },
    });
    expect(parseSectorZeroProgress(raw, data).forgeShards).toEqual({ radar_module: 2 });
  });
});

describe('PVR-6.2 — в подготовке только корпуса, которые игрок строит', () => {
  const hulls = sectorHullIds(data);

  it('нет вражеских и выдаваемых корпусов', () => {
    for (const id of ['swarm_brood_mother', 'swarm_lander', 'fortress_guns'])
      expect(hulls, id).not.toContain(id);
  });

  it('обычные корабли игрока на месте', () => {
    for (const id of ['frigate', 'cruiser', 'scout', 'strike_carrier', 'shuttle_carrier'])
      expect(hulls, id).toContain(id);
  });

  it('фильтр держится на данных: новый уникальный юнит фракции сюда не попадёт', () => {
    const extra = structuredClone(data);
    extra.units.test_hive = { ...extra.units.cruiser!, faction: 'swarm' };
    extra.factions.swarm!.uniqueUnits = [...extra.factions.swarm!.uniqueUnits, 'test_hive'];
    expect(sectorHullIds(extra)).not.toContain('test_hive');
  });
});

describe('PVR-6.5 — в подготовке только модули, которые есть куда поставить', () => {
  const modules = sectorModuleIds(data);

  it('нет модулей Роя и щитов крепости', () => {
    for (const id of ['swarm_brood_chamber', 'swarm_intercept_veil', 'void_shield_i', 'void_shield_ii', 'void_shield_iii'])
      expect(modules, id).not.toContain(id);
  });

  it('модули кораблей игрока на месте — и узкие тоже', () => {
    // Радар встаёт только на разведчика: это не повод его прятать, разведчик у игрока есть.
    for (const id of ['cargo_bay', 'ion_engine', 'targeting_array', 'shield_booster', 'radar_module'])
      expect(modules, id).toContain(id);
  });
});


describe('SZE-5.2 — повышение редкости модуля', () => {
  const ready = (): SectorZeroProgress => ({
    ...fresh(),
    blueprints: { unique: 1, mythic: 1 },
    moduleCopies: { cargo_bay: 7 },
  });

  it('списывает чертёж следующей ступени и 3 дубля, модуль становится уникальным', () => {
    const next = change(ready(), { kind: 'raise-rarity', id: 'cargo_bay' });
    expect(next.moduleRarity.cargo_bay).toBe('unique');
    expect(next.blueprints).toEqual({ mythic: 1 }); // пустой счётчик не хранится
    expect(next.moduleCopies.cargo_bay).toBe(4);
    // Следующая ступень — уже мифическим чертежом.
    const again = change(next, { kind: 'raise-rarity', id: 'cargo_bay' });
    expect(again.moduleRarity.cargo_bay).toBe('mythic');
    expect(again.blueprints).toEqual({});
    expect(again.moduleCopies.cargo_bay).toBe(1);
  });

  it('без чертежа, без дублей и у закрытого модуля — отказ, профиль не тронут', () => {
    expect(
      changeSectorZeroProgress({ ...ready(), blueprints: {} }, { kind: 'raise-rarity', id: 'cargo_bay' }, data),
    ).toBeNull();
    expect(
      changeSectorZeroProgress({ ...ready(), moduleCopies: { cargo_bay: 2 } }, { kind: 'raise-rarity', id: 'cargo_bay' }, data),
    ).toBeNull();
    expect(
      changeSectorZeroProgress(ready(), { kind: 'raise-rarity', id: 'targeting_array' }, data),
    ).toBeNull();
  });

  it('поднятая редкость поднимает и потолок звёзд', () => {
    const atSimpleCap = { ...ready(), warrants: 9999, stars: { cargo_bay: 3 } };
    expect(changeSectorZeroProgress(atSimpleCap, { kind: 'forge', id: 'cargo_bay' }, data)).toBeNull();
    const raised = change(atSimpleCap, { kind: 'raise-rarity', id: 'cargo_bay' });
    expect(change(raised, { kind: 'forge', id: 'cargo_bay' }).forgeTries.cargo_bay).toBe(1);
  });

  it('редкость, дубли и чертежи переживают сохранение, мусор отсекается', () => {
    const raw = JSON.stringify({
      ...fresh(),
      moduleRarity: { cargo_bay: 'mythic', targeting_array: 'simple', ghost: 'legendary', ion_engine: 'cosmic' },
      moduleCopies: { cargo_bay: 3, ion_engine: -1, ghost: 5, radar_module: 1.5 },
      blueprints: { unique: 2, simple: 4, cosmic: 1, mythic: -1 },
    });
    const p = parseSectorZeroProgress(raw, data);
    expect(p.moduleRarity).toEqual({ cargo_bay: 'mythic' });
    expect(p.moduleCopies).toEqual({ cargo_bay: 3 });
    expect(p.blueprints).toEqual({ unique: 2 });
    const { moduleRarity: _r, moduleCopies: _c, blueprints: _b, ...legacy } = fresh();
    const old = parseSectorZeroProgress(JSON.stringify(legacy), data);
    expect([old.moduleRarity, old.moduleCopies, old.blueprints]).toEqual([{}, {}, {}]);
  });

  it('редкость едет в забег снимком — и в числа корабля', () => {
    const p = change(fresh(), { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    const raised = { ...p, moduleRarity: { ion_engine: 'mythic' } };
    const s = prepareSectorZeroRun(pveState(data), raised, data);
    const cruiser = s.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!;
    expect(cruiser.moduleRarity).toEqual({ ion_engine: 'mythic' });
    expect(s.players.p1?.arsenal?.rarity).toEqual({ ion_engine: 'mythic' });
    const plain = prepareSectorZeroRun(pveState(data), p, data);
    const plainCruiser = plain.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!;
    expect(plainCruiser.moduleRarity).toBeUndefined();
    const hpOf = (st: typeof cruiser): number => effectiveStats(data.units.cruiser!, st, data).hp!;
    // Мифический ионный двигатель несёт параметры уникальной и мифической ступеней.
    expect(hpOf(cruiser) - hpOf(plainCruiser)).toBe(data.modules.ion_engine!.rarityBonus!.mythic!.hp);
  });
});

describe('SZE-5.3 — итог забега приносит дубли и чертежи', () => {
  it('засчёт кладёт добычу в профиль и в итог, первая победа — с чертежом главы', () => {
    const s = pveState(data);
    s.pve = { waveNumber: 4, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p1';
    const before = { ...fresh(), nextAttempt: 2 };
    const chapter = { id: 'ch-1', objectives: [], blueprint: 'unique' as const };
    const after = settleSectorZeroRun(before, 1, s, chapter);
    const copies = Object.values(after.moduleCopies).reduce((a, b) => a + b, 0);
    expect(copies).toBe(2); // забег + победа
    expect(after.blueprints.unique ?? 0).toBeGreaterThanOrEqual(1);
    expect(after.lastRun?.loot?.copies).toEqual(after.moduleCopies);
    // Повторная победа той же главы гарантированного чертежа уже не даёт: добыча ровно
    // та, что у забега без него.
    const again = settleSectorZeroRun({ ...after, nextAttempt: 3 }, 2, s, chapter);
    expect(again.lastRun!.loot).toEqual(
      runLoot({
        seed: after.seed,
        attempt: 2,
        modules: after.modules,
        won: true,
        newTasks: 0,
        firstWinBlueprint: null,
        outcome: hashState(s),
      }),
    );
  });

  it('AUD-26: бросок — от ИТОГОВОГО мира, а не от одного номера попытки', () => {
    const at = (time: number): GameState => {
      const s = pveState(data);
      s.pve = { waveNumber: 10, totalWaves: 10, npcPlayerId: 'p3' };
      s.match.status = 'ended';
      s.match.winner = 'p1';
      s.time = time;
      return s;
    };
    const base = { ...fresh(), nextAttempt: 2 };
    const loots = new Set(
      Array.from({ length: 40 }, (_, i) =>
        JSON.stringify(settleSectorZeroRun(base, 1, at(1000 + i)).lastRun?.loot),
      ),
    );
    expect(loots.size).toBeGreaterThan(1);
  });

  it('AUD-26: живой мир и его снимок из хранилища дают ОДНУ добычу — путей засчёта два', () => {
    // Конец забега засчитывается либо сразу (живой мир), либо из журнала при следующем
    // открытии меню (JSON-снимок). Отпечаток мира обязан совпасть, иначе игрок, закрывший
    // вкладку между записями, увидел бы другую добычу, чем на экране итогов.
    const s = pveState(data);
    s.pve = { waveNumber: 10, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p1';
    (s as unknown as Record<string, unknown>).probe = undefined;
    const base = { ...fresh(), nextAttempt: 2 };
    const live = settleSectorZeroRun(base, 1, s).lastRun?.loot;
    const journaled = settleSectorZeroRun(base, 1, JSON.parse(JSON.stringify(s)) as GameState).lastRun?.loot;
    expect(journaled).toEqual(live);
  });

  it('итог с добычей переживает сохранение; старый итог без неё тоже читается', () => {
    const s = pveState(data);
    s.pve = { waveNumber: 2, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    const after = settleSectorZeroRun({ ...fresh(), nextAttempt: 2 }, 1, s);
    const reread = parseSectorZeroProgress(JSON.stringify(after), data);
    expect(reread.lastRun?.loot).toEqual(after.lastRun?.loot);
    expect(reread.moduleCopies).toEqual(after.moduleCopies);
    const { loot: _drop, ...oldRun } = after.lastRun!;
    expect(parseSectorZeroProgress(JSON.stringify({ ...after, lastRun: oldRun }), data).lastRun?.loot).toBeUndefined();
  });
});

describe('ремонт в забеге за Суверены (заказ владельца 2026-09-24)', () => {
  it('цена: 0 — чинить нечего; иначе не меньше одного, дальше по 25 HP', () => {
    expect(sovereignRepairCost(0)).toBe(0);
    expect(sovereignRepairCost(Number.NaN)).toBe(0);
    expect(sovereignRepairCost(1)).toBe(1);
    expect(sovereignRepairCost(25)).toBe(1);
    expect(sovereignRepairCost(26)).toBe(2);
    expect(sovereignRepairCost(300)).toBe(12);
  });

  it('списывает цену; не хватает или нечего чинить — отказ, кошелёк цел', () => {
    const p = { ...fresh(), sovereigns: 12 };
    expect(change(p, { kind: 'premium-repair', hull: 300 }).sovereigns).toBe(0);
    expect(changeSectorZeroProgress(p, { kind: 'premium-repair', hull: 301 }, data)).toBeNull();
    expect(changeSectorZeroProgress(p, { kind: 'premium-repair', hull: 0 }, data)).toBeNull();
    expect(p.sovereigns).toBe(12);
  });
});
