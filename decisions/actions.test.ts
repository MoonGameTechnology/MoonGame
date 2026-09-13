import { describe, expect, it } from 'vitest';
import {
  act,
  assaultFleet,
  bombardFleet,
  buildBuilding,
  buildShip,
  buildUnit,
  cancelConstruction,
  canTraverse,
  castHeroAbility,
  chainStamp,
  declareWar,
  delegateSteward,
  designateCapital,
  engageFleet,
  equipHeroAbility,
  forceMarchFleet,
  installHeroModule,
  instantRepairFleet,
  launchFleet,
  loadArmy,
  loadShuttle,
  loadSquadronTroops,
  marketCancel,
  marketList,
  marketTake,
  mergeFleet,
  mergeSquadron,
  moveFleet,
  moveFleetEdge,
  orbitFleet,
  orderAuto,
  orderChain,
  orderScramble,
  recallSteward,
  repairFleet,
  researchTech,
  resumeConstruction,
  retreatFleet,
  setHoldPoint,
  shareMap,
  spawnHero,
  splitFleet,
  splitSquadron,
  spyOn,
  stopFleet,
  strikeShuttle,
  unequipHeroAbility,
  uninstallHeroModule,
  unloadArmy,
  unloadShuttle,
  unloadSquadronTroops,
  unlockHeroSkill,
  upgradeBuilding,
} from './actions';
import {
  CLIENT_ACTION_TYPES,
  isValidActionPayload,
  type Action,
  type GameState,
} from '../packages/shared-core/src/index';

/**
 * Каждый строитель, вызванный правдоподобно. Список ведётся руками нарочно: он и есть
 * утверждение «вот все приказы, которые клиент умеет выписать», и разойтись с файлом
 * молча не может — тест ниже сверяет его с каталогом гейта в обе стороны.
 */
const P = 'p1';
const CALLS: ReadonlyArray<readonly [string, Action]> = [
  ['moveFleet', moveFleet(P, 'f1', 'beta')],
  ['moveFleetEdge', moveFleetEdge(P, 'f1', { from: 'a', to: 'b', t: 0.5 })],
  ['stopFleet', stopFleet(P, 'f1')],
  ['orbitFleet', orbitFleet(P, 'f1')],
  ['assaultFleet', assaultFleet(P, 'f1')],
  ['retreatFleet', retreatFleet(P, 'f1')],
  ['bombardFleet', bombardFleet(P, 'f1', true)],
  ['strikeShuttle', strikeShuttle(P, { planetId: 'alpha' }, 'sq1', { targetPlanetId: 'beta' })],
  ['strikeShuttle (носитель)', strikeShuttle(P, { fleetId: 'f1' }, 'sq1', { targetFleetId: 'f2' })],
  ['loadShuttle', loadShuttle(P, 'f1', 'sq1')],
  ['unloadShuttle', unloadShuttle(P, 'f1', 'sq1')],
  ['splitSquadron', splitSquadron(P, { planetId: 'alpha' }, 'sq1', [{ unit: 'u', count: 2 }])],
  ['mergeSquadron', mergeSquadron(P, { fleetId: 'f1' }, 'sq1', 'sq2')],
  ['loadSquadronTroops', loadSquadronTroops(P, { planetId: 'alpha' }, 'sq1', [{ unit: 'u', count: 1 }])],
  ['unloadSquadronTroops', unloadSquadronTroops(P, { planetId: 'alpha' }, 'sq1', [{ unit: 'u', count: 1 }])],
  ['unloadSquadronTroops (весь трюм)', unloadSquadronTroops(P, { planetId: 'alpha' }, 'sq1')],
  ['loadArmy', loadArmy(P, 'f1', 'infantry', 2)],
  ['unloadArmy', unloadArmy(P, 'f1', 'infantry')],
  ['launchFleet', launchFleet(P, 'alpha')],
  ['mergeFleet', mergeFleet(P, 'f1', 'f2')],
  ['splitFleet', splitFleet(P, 'f1', [{ unit: 'cruiser', count: 1 }])],
  ['splitFleet (с десантом)', splitFleet(P, 'f1', [{ unit: 'cruiser', modules: ['m'], count: 1 }], [{ unit: 'infantry', count: 1 }])],
  ['buildBuilding', buildBuilding(P, 'alpha', 'metal_mine')],
  ['upgradeBuilding', upgradeBuilding(P, 'alpha', 'metal_mine')],
  ['buildUnit', buildUnit(P, 'alpha', 'cruiser', 2)],
  ['buildShip', buildShip(P, 'alpha', 'cruiser', 1, ['railgun'])],
  ['cancelConstruction', cancelConstruction(P, 'alpha', 7)],
  ['resumeConstruction', resumeConstruction(P, 'alpha', 7)],
  ['engageFleet', engageFleet(P, 'f1', 'f2')],
  ['researchTech', researchTech(P, 'optics')],
  ['delegateSteward', delegateSteward(P, 3_600_000)],
  ['recallSteward', recallSteward(P)],
  ['setHoldPoint', setHoldPoint(P, 'alpha', true)],
  ['shareMap', shareMap(P, 'p2', true)],
  ['declareWar', declareWar(P, 'p2')],
  ['spyOn', spyOn(P, 'p2', 'fleets')],
  ['spyOn (мир)', spyOn(P, 'p2', 'planet', 'alpha')],
  ['castHeroAbility', castHeroAbility(P, 'h1', 'corridor')],
  ['castHeroAbility (по цели)', castHeroAbility(P, 'h1', 'corridor', 'alpha')],
  ['orderAuto', orderAuto(P, 'f1', true)],
  ['orderScramble', orderScramble(P, { planetId: 'alpha' }, true)],
  ['orderChain', orderChain(P, 'f1', [{ kind: 'move', to: 'beta' }, { kind: 'assault' }])],
  ['forceMarchFleet', forceMarchFleet(P, 'f1', true)],
  ['instantRepairFleet', instantRepairFleet(P, 'f1')],
  ['repairFleet', repairFleet(P, 'f1')],
  ['marketList', marketList(P, 'sell', 'metal', 10, 3)],
  ['marketTake', marketTake(P, 'lot1', 5)],
  ['marketTake (весь лот)', marketTake(P, 'lot1')],
  ['marketCancel', marketCancel(P, 'lot1')],
  ['designateCapital', designateCapital(P, 'alpha')],
  ['spawnHero', spawnHero(P, 'h1', 'alpha')],
  ['unlockHeroSkill', unlockHeroSkill(P, 'h1', 'node1')],
  ['installHeroModule', installHeroModule(P, 'h1', 'plating')],
  ['uninstallHeroModule', uninstallHeroModule(P, 'h1', 'plating')],
  ['equipHeroAbility', equipHeroAbility(P, 'h1', 'corridor')],
  ['unequipHeroAbility', unequipHeroAbility(P, 'h1', 'corridor')],
];

describe('строители приказов против схем гейта', () => {
  // Это главное свойство файла. Строитель — клиентская половина контракта, чья вторая
  // половина живёт в ядре (`actionPayloadSchemas`) и проверяется ДО редьюсера. Разъезд
  // половин не роняет ни typecheck, ни сборку: он доезжает до игрока кнопкой, которая
  // молча отвечает `E_BAD_PAYLOAD`. Поэтому сверяем каждый вызов настоящей схемой.
  it.each(CALLS.map(([name, action]) => [name, action] as const))(
    '%s строит payload, который гейт принимает',
    (_name, action) => {
      expect(isValidActionPayload(action.type, action.payload)).toBe(true);
    },
  );

  it('ни один строитель не выписывает тип мимо каталога гейта', () => {
    const gated = new Set(CLIENT_ACTION_TYPES);
    expect([...new Set(CALLS.map(([, a]) => a.type))].filter((t) => !gated.has(t))).toEqual([]);
  });

  it('`chain.stamp` гейтом НЕ признан — клиент не вправе двигать свою же цепочку', () => {
    // Схемы у него нет НАМЕРЕННО (`payloadSchemas.ts` это проговаривает): штамп
    // «голова съедена / ожидание взведено» ставит СЕРВЕРНЫЙ драйвер, и строитель здесь
    // существует ради него (`serverDrivers.ts`), а не ради интерфейса. Если схема для
    // него однажды появится, этот тест упадёт — и это правильный повод остановиться.
    expect(CLIENT_ACTION_TYPES).not.toContain('chain.stamp');
    expect(isValidActionPayload('chain.stamp', chainStamp(P, 'f1', []).payload)).toBe(false);
  });

  it('пять приказов каталога не строит НИКТО — у игрока нет способа их отдать', () => {
    // Не придирка к списку, а честный замер охвата: ядро принимает 53 типа, клиент
    // умеет выписать 48. Список зафиксирован, чтобы новая дыра не появилась молча, а
    // закрытая — заставила его сократить.
    const built = new Set(CALLS.map(([, a]) => a.type));
    expect(CLIENT_ACTION_TYPES.filter((t) => !built.has(t)).sort()).toEqual([
      'hero.move',
      'planet.annihilate',
      'seat.claim',
      'station.deploy',
      'technology.boost',
    ]);
  });
});

describe('конверт приказа', () => {
  it('id уникален и называет игрока — иначе сервер не различит два приказа подряд', () => {
    const a = stopFleet('ash', 'f1');
    const b = stopFleet('ash', 'f1');
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith('ui:ash:')).toBe(true);
  });

  it('время выставляет НЕ клиент: issuedAt всегда 0', () => {
    // Часы игрока не власть: время приказу ставит сервер, когда приказ до него доедет.
    expect(act('ash', 'fleet.stop', { fleetId: 'f1' }).issuedAt).toBe(0);
  });
});

describe('необязательное поле ОТСУТСТВУЕТ, а не равно undefined', () => {
  // У каждого из этих полей «нет значения» — самостоятельный смысл, а не пропуск:
  // весь трюм вместо части, весь лот вместо доли, приказ без цели. Ключ со значением
  // `undefined` переживает JSON-сериализацию как ОТСУТСТВИЕ и читался бы так же — но
  // до сериализации он есть, и рукописная проверка `'troops' in payload` (а такие в
  // обработчиках встречаются) увидела бы его и прочла наоборот.
  const keys = (a: Action): string[] => Object.keys(a.payload as object);

  it('выгрузка без списка не несёт troops', () => {
    expect(keys(unloadSquadronTroops(P, { planetId: 'alpha' }, 'sq1'))).not.toContain('troops');
  });
  it('заполнение лота без доли не несёт amount', () => {
    expect(keys(marketTake(P, 'lot1'))).not.toContain('amount');
  });
  it('деление без десанта не несёт takeLanding', () => {
    expect(keys(splitFleet(P, 'f1', [{ unit: 'cruiser', count: 1 }]))).not.toContain('takeLanding');
  });
  it('слежка не за миром не несёт planetId', () => {
    expect(keys(spyOn(P, 'p2', 'fleets'))).not.toContain('planetId');
  });
  it('способность без цели не несёт target', () => {
    expect(keys(castHeroAbility(P, 'h1', 'corridor'))).not.toContain('target');
  });
  it('штамп без ожидания не несёт waitUntil', () => {
    expect(keys(chainStamp(P, 'f1', []))).not.toContain('waitUntil');
  });
});

describe('пропуск флота через чужую провинцию', () => {
  const state = (stance: string | undefined): GameState =>
    ({ diplomacy: stance ? { 'p1|p2': stance } : {} }) as unknown as GameState;

  it('ничей и свой мир проходим всегда', () => {
    expect(canTraverse(state(undefined), 'p1', null)).toBe(true);
    expect(canTraverse(state(undefined), 'p1', 'p1')).toBe(true);
  });

  it('МИР запирает дорогу — это и есть повод объявить войну', () => {
    // Правило неочевидное: запирает именно мир, а не вражда. Флот, посланный через
    // мирного соседа, отскочит от ядра — поэтому `warOrders.ts` объявляет войну ПЕРЕД
    // приказом движения, а не после.
    expect(canTraverse(state('peace'), 'p1', 'p2')).toBe(false);
  });

  it('война, пакт и альянс — проходимы', () => {
    for (const stance of ['war', 'pact', 'alliance']) {
      expect(canTraverse(state(stance), 'p1', 'p2')).toBe(true);
    }
  });
});
