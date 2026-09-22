import type { GameModule, HandlerContext } from '../kernel/module';
import type { Context } from '../action/types';
import { buildingLevel, type ResourceBag } from '../data/schemas';
import type { Planet, UnitStack } from '../state/gameState';
import { effectiveStats } from '../util/loadout';
import { canAfford, payCost } from '../util/treasury';
import { isCapturable, isStationable } from '../state/sectorKind';

/**
 * КОСМИЧЕСКАЯ КРЕПОСТЬ (`fortress-roadmap.md` §0.6, решение владельца 2026-09-15).
 *
 * Местность на карте почти вся незастраиваема: на туманности, кладбище, ионном шторме,
 * плотной туманности и вспышке нельзя возвести НИЧЕГО. Это 90 узлов из 121 на карте
 * прототипа — декорация с бонусами к скорости и живучести. Крепость — тот шаг, который
 * превращает захваченную декорацию в развиваемое владение с орбитой и своим ростером
 * построек: захват делает узел твоим, крепость делает его полезным.
 *
 * `station.deploy` переводит СВОЙ узел в вид `void_station`, после чего обычный
 * `building.construct` поднимает на нём радар, верфь, форт и прочее из ростера вида.
 * Крепость — настоящее владение: оставил без прикрытия, и враг занимает её прилётом,
 * как любой другой узел.
 *
 * ДВА ПРАВИЛА, И ОБА ПРИШЛИ ОТ ВЛАДЕЛЬЦА, А НЕ ИЗ УДОБСТВА КОДА:
 *
 * 1. **Только на ЗАХВАЧЕННОЙ территории.** Прежде требовался флот-якорь на узле; теперь
 *    доказательством служит само владение — там, где ты не был, узел твоим не стал бы.
 *    Это заодно закрывает незахватываемые виды (пустота, обломки, чёрная дыра) без
 *    отдельного запрета: своими они не становятся никогда.
 * 2. **На всех видах, кроме тех, где уже есть планета** — и кроме уже стоящей крепости.
 *    Правило живёт В ДАННЫХ (`sectorKinds.stationable`), а не строкой `'planet'` здесь:
 *    иначе каждый новый вид местности пришлось бы вспоминать руками.
 *
 * Прежняя форма требовала узел вида `empty` и технический юнит-конвертер; и то и другое
 * снято решением владельца, см. §0.6 роадмапа («что эти решения отменяют»).
 *
 * New mechanic = new module + data; the kernel is untouched, state stays pure JSON.
 */

const STATION_KIND = 'void_station';
/** Чем становится узел, если крепость погибла, а память о прежнем виде взять неоткуда:
 *  так бывает у крепости, ПОСЕЯННОЙ картой или сценарием сразу как `void_station` —
 *  конверсии не было, значит и запоминать было нечего. Пустое пространство — честный
 *  ответ: узел остаётся на карте, но застраивать на нём нечего. */
const DEFAULT_PRIOR_KIND = 'empty';
/**
 * ЯДРО крепости — здание, в котором живёт её уровень (FORT-5.2, решение владельца 18).
 *
 * Почему зданием, а не полем узла: уровень, HP и прокачка в этой игре существуют ТОЛЬКО
 * у `BuildingInstance`; у вида узла их нет и быть не может — вид это ярлык, а не объект.
 * Здание при этом не новое: владелец решил дорастить `starfort` («Void Fortress»), а не
 * заводить рядом второе с тем же смыслом.
 *
 * Руками его не строят: в каталоге у него `onlyOn: []` — «возводится нигде», тот же
 * способ сказать «нет», каким `allowedBuildings: []` закрывает застройку вида. Появляется
 * оно ровно здесь, вместе с крепостью, и растёт обычным `building.upgrade` (тот ростера
 * и `onlyOn` не спрашивает — проверено, иначе прокачка встала бы вместе с постройкой).
 */
const CORE_BUILDING = 'starfort';
/** Цена крепости. ЭКСПОРТИРУЕТСЯ намеренно: кнопку рисует клиент, и своя копия числа у
 *  него — это ровно тот способ, которым интерфейс начинает обещать то, что редьюсер
 *  отклоняет (прецедент ORB-4 записан в `main.ts`: три собственных `?? BUILDABLE` развели
 *  клиентское правило с данными). Одно число, один дом. */
export const STATION_COST: ResourceBag = { metal: 120 };

/**
 * ОРУДИЯ КРЕПОСТИ — неподвижный отряд, которым крепость ВОЮЕТ (FORT-5.4, решение
 * владельца 9: «как будто космический юнит; прилетит вражеский флот — вступит в бой»).
 *
 * ПОЧЕМУ ОТРЯД, А НЕ НОВЫЙ ВИД СТОРОНЫ В БОЮ. Стороной орбитальной фазы сегодня бывает
 * флот; гарнизон — сторона НАЗЕМНАЯ. Завести пятый вид участника значило бы научить бой
 * собирать его состав, применять по нему урон, понимать его гибель, проецировать его в
 * тумане и слать по сети — вчетверо больше работы ради того же поведения. Отряд же
 * попадает в бой существующим движком, и три правила достаются даром:
 *   • увести его нельзя — `speed: 0` роняет `beginLeg` (`E_FLEET_IMMOBILE`);
 *   • узел не забирают прилётом, пока он жив — `captureOnArrival` видит чужой отряд;
 *   • побитые орудия чинятся сами, если на крепости есть верфь (обычный доковый ремонт).
 *
 * СИЛА ИДЁТ ОТ УРОВНЯ ЯДРА, а не второй лестницей: в стеке ровно `level` орудий, поэтому
 * корпус и урон растут прокачкой сами, без единого нового поля.
 */
const GUNS_UNIT = 'fortress_guns';

/** Id отряда крепости — ДЕТЕРМИНИРОВАННЫЙ, по узлу. Не через счётчик флотов: отряд не
 *  заводится игроком, а принадлежит узлу, и «найти орудия этой крепости» обязано быть
 *  чистым поиском по ключу, а не перебором с угадыванием. */
const gunsFleetId = (planetId: string): string => `fleet:station:${planetId}`;

/** Обратное к {@link gunsFleetId}: чьи это орудия. Не совпало — не крепость, и это
 *  обычный флот, до которого станции дела нет. */
function planetOfGunsFleet(fleetId: string): string | null {
  const prefix = 'fleet:station:';
  return fleetId.startsWith(prefix) ? fleetId.slice(prefix.length) : null;
}

/**
 * ЩИТ КРЕПОСТИ (FORT-5.10, решение владельца 20: «снаряжение на крепости»).
 *
 * Здание щитов не считает щит само — оно НАДЕВАЕТ на орудия одну из трёх ступеней
 * модуля, и дальше щит живёт по общим корабельным правилам: `effectiveStats` суммирует
 * модули, поглощение и восстановление читают её же. Поэтому путь боевого урона этот
 * кирпич не трогает ВООБЩЕ — а трогать его пришлось бы у обоих отклонённых путей
 * (свой хук в `damageUnits`; свой пул у здания).
 *
 * Ступень выбирается УРОВНЕМ здания, а не повтором одного модуля: каталог запрещает
 * один и тот же id дважды (`E_DUP_MODULE`), так что «три уровня = три модуля» —
 * единственная форма, при которой `canEquip` остаётся правдой.
 */
const SHIELD_BUILDING = 'void_shield';
const SHIELD_STEPS = ['void_shield_i', 'void_shield_ii', 'void_shield_iii'] as const;

/** Какая ступень щита надета на крепость: по уровню живого здания щитов. Нет здания
 *  (не построено или снесено) → щита нет, и это не «ноль щита», а отсутствие модуля. */
function shieldStep(planet: Planet): string | null {
  const b = planet.buildings.find((x) => x.type === SHIELD_BUILDING && x.hp > 0);
  if (!b) return null;
  return SHIELD_STEPS[Math.min(Math.max(b.level, 1), SHIELD_STEPS.length) - 1] ?? null;
}

/** Надеть/снять ступень щита на стек орудий.
 *
 *  Накопленный `shieldHp` при СНИЖЕНИИ ступени подрезается: пул считается от надетого
 *  модуля, и оставить старое число значило бы дать щиту поглотить больше, чем он теперь
 *  вмещает. При РОСТЕ ступени не трогаем — щит дозаряжается обычной регенерацией, а не
 *  мгновенно (та же причина, по которой прокачка не лечит орудия). */
function fitShield(stack: UnitStack, step: string | null, ctx: Context): void {
  stack.modules = step ? [step] : undefined;
  if (stack.shieldHp === undefined) return;
  const def = ctx.data.units[GUNS_UNIT];
  if (!def) return;
  const full = stack.count * (effectiveStats(def, stack, ctx.data).shield ?? 0);
  stack.shieldHp = Math.min(stack.shieldHp, full);
}

/**
 * Привести орудия крепости в соответствие с ядром — ОДИН дом на все поводы (конверсия,
 * прокачка и разрушение ядра, смена владельца узла, а с FORT-5.10 ещё и постройка,
 * прокачка и снос здания ЩИТОВ: щит — снаряжение орудий). Копии этого
 * правила разошлись бы молча: ровно так в этом репозитории уже расходились два хука
 * наземной защиты форта.
 *
 * Правило: есть живое ядро и у узла есть владелец → отряд существует, принадлежит
 * владельцу узла и насчитывает `level` орудий. Нет ядра (снесено) или узел ничей →
 * отряда нет.
 *
 * Уже стоящий отряд НЕ пополняется до полного: подросший уровень добавляет орудия, но
 * потери прошлого боя лечит доковый ремонт, а не эта функция. Иначе прокачка работала бы
 * мгновенной аптечкой.
 */
function syncStationGuns(h: HandlerContext, planet: Planet): void {
  const id = gunsFleetId(planet.id);
  const existing = h.state.fleets[id];
  const core = planet.buildings.find((b) => b.type === CORE_BUILDING && b.hp > 0);
  if (!core || planet.owner === null) {
    if (existing) delete h.state.fleets[id];
    return;
  }
  const step = shieldStep(planet);
  if (!existing) {
    const fresh: UnitStack = { unit: GUNS_UNIT, count: core.level };
    fitShield(fresh, step, h.ctx);
    h.state.fleets[id] = {
      id,
      owner: planet.owner,
      location: planet.id,
      movement: null,
      units: [fresh],
      landing: [],
      traits: [],
      battleId: null,
    };
    return;
  }
  existing.owner = planet.owner;
  const stack = existing.units.find((u) => u.unit === GUNS_UNIT);
  if (!stack) {
    const fresh: UnitStack = { unit: GUNS_UNIT, count: core.level };
    fitShield(fresh, step, h.ctx);
    existing.units.push(fresh);
  } else {
    if (stack.count < core.level) {
      stack.count = core.level; // прокачка ДОБАВЛЯЕТ орудия; потери чинит док, не она
    }
    fitShield(stack, step, h.ctx);
  }
}

export const stationModule: GameModule = {
  id: 'station',
  version: '1.0.0',
  setup(api) {
    api.onAction('station.deploy', (action, h: HandlerContext) => {
      const { planetId } = action.payload as { planetId?: string };
      if (typeof planetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const node = h.state.planets[planetId];
      if (!node) return h.reject('E_NO_PLANET');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_FORBIDDEN'); // not a participant / no treasury
      // Правило 1: только СВОЙ узел. Чужой и ничейный отбиваются одним кодом намеренно —
      // fail-secure: отказ не обязан рассказывать, чей узел на самом деле.
      if (node.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      // Правило 2: вид должен принимать крепость. Уже стоящая крепость отбивается тем же
      // флагом (`void_station.stationable: false`), поэтому «второй раз» — не отдельная
      // ветка, а тот же запрет.
      if (!isStationable(h.ctx.data, node)) return h.reject('E_NOT_STATIONABLE');
      if (!canAfford(player.resources, STATION_COST)) return h.reject('E_INSUFFICIENT');

      // Ядро обязано быть в каталоге: без него крепость вышла бы бестелесной — без HP,
      // без стрельбы и без уровня, то есть обещание действия не выполнилось бы. Отказ
      // честнее молчаливой пустышки (инвариант fail-secure).
      const core = h.ctx.data.buildings[CORE_BUILDING];
      if (!core) return h.reject('E_UNKNOWN_BUILDING');
      // Правило 3: крепость надо ИЗУЧИТЬ (решение владельца 12, FORT-5.1). Спрашиваем
      // ТОТ ЖЕ хук, которым гейтятся здания, и про то же самое здание — ядро. Своей
      // проверки «изучена ли технология крепости» тут нет намеренно: правило живёт в
      // `technology.ts`, а два дома у одного правила — это ровно тот разъезд, которым
      // болели ворота стройки до ORB-4. Нет модуля технологий — база хука разрешает, и
      // сценарии без дерева работают как прежде.
      const unlock = h.hook<{ allowed: boolean; code?: string }>(
        'construction.requirement',
        { allowed: true },
        { playerId: action.playerId, kind: 'building', id: CORE_BUILDING },
      );
      if (!unlock.allowed) return h.reject(unlock.code ?? 'E_LOCKED');

      payCost(player.resources, STATION_COST);
      // Чем узел БЫЛ до конверсии — запоминаем, потому что гибель крепости обязана его
      // вернуть (FORT-5.13, решение владельца 22). Без этой памяти разрушенная крепость
      // навсегда стирала бы астероидное поле под собой: вид узла затирается здесь, а
      // восстановить его потом неоткуда. Это тот же класс дефекта, который решение 8
      // уже ловило на добыче — «разрушат, а отстраивать негде».
      node.priorKind = node.kind ?? DEFAULT_PRIOR_KIND;
      node.kind = STATION_KIND; // ownable + buildable: radar/fort/… via building.construct
      node.buildings.push({ type: CORE_BUILDING, level: 1, hp: buildingLevel(core, 1).hp });
      syncStationGuns(h, node);
      h.emit('station.deployed', { planetId, owner: action.playerId });
    });

    // Прокачка ядра добавляет орудия; разрушение — снимает их вместе с ядром. Здание
    // ЩИТОВ ходит теми же событиями, но у него значима ещё и ПОСТРОЙКА: ядро игрок не
    // строит (оно приходит с конверсией), а щит — обычная стройка из ростера.
    const WATCHED: readonly string[] = [CORE_BUILDING, SHIELD_BUILDING];
    for (const evt of ['building.constructed', 'building.upgraded', 'building.destroyed'] as const) {
      api.on(evt, (event, h) => {
        const p = event.payload as { planetId?: string; building?: string };
        if (typeof p.building !== 'string' || !WATCHED.includes(p.building)) return;
        if (typeof p.planetId !== 'string') return;
        const planet = h.state.planets[p.planetId];
        if (planet) syncStationGuns(h, planet);
      });
    }

    /**
     * КРЕПОСТЬ ГИБНЕТ ВМЕСТЕ СО СВОИМИ ПОСТРОЙКАМИ (FORT-5.13, решение владельца 22,
     * 2026-09-22: «крепость будет уничтожена, а не перейдёт»).
     *
     * До этого крепость нельзя было РАЗРУШИТЬ — её можно было только отнять, причём
     * ДАРОМ: пока орудия живы, узел не берут прилётом, а как только их выбили,
     * захватчик занимал узел и получал чужую крепость целой — все постройки плюс
     * заново выданный по уровню ядра расчёт. Вложение защитника (металл, постройки,
     * две технологии) переходило победителю в полном объёме, и сильный бесплатно
     * забирал базу у слабого.
     *
     * Теперь выбитые орудия означают ГИБЕЛЬ сооружения: постройки уходят вместе с ядром,
     * а узел возвращается к тому виду, каким был до конверсии. Захватчику достаётся
     * голое место — хочет здесь крепость, строит свою, за свои ресурсы и свои
     * технологии. Это и есть «крепость — такой же юнит»: юнита, которого убили, к врагу
     * не переходит, он умирает.
     *
     * ВИД УЗЛА ВОЗВРАЩАЕТСЯ, а не сбрасывается в пустоту: под крепостью могло быть
     * астероидное поле, и стереть его гибелью значило бы отнять у карты ресурсный узел
     * навсегда. Память о прежнем виде кладёт сама конверсия.
     *
     * ВЛАДЕЛЬЦА НЕ ТРОГАЕМ. Узел стал своим ЗАХВАТОМ, а не крепостью, и гибель
     * сооружения не отменяет захвата. Дальше он берётся обычным прилётом, как любой
     * незащищённый узел, — то есть «голое место» достаётся победителю ровно тем же
     * способом, каким достаётся любая другая пустая провинция.
     */
    api.on('fleet.destroyed', (event, h) => {
      const p = event.payload as { fleetId?: string };
      if (typeof p.fleetId !== 'string') return;
      const planetId = planetOfGunsFleet(p.fleetId);
      if (planetId === null) return;
      const planet = h.state.planets[planetId];
      if (!planet || !planet.buildings.some((b) => b.type === CORE_BUILDING)) return;
      const owner = planet.owner;
      planet.kind = planet.priorKind ?? DEFAULT_PRIOR_KIND;
      delete planet.priorKind;
      // УЗЕЛ, КОТОРЫЙ НЕЛЬЗЯ ЗАХВАТИТЬ, НЕЛЬЗЯ И ДЕРЖАТЬ. Вернувшийся вид бывает
      // незахватываемым — пустое пространство прежде всего, — и оставить у него хозяина
      // значило бы завести неуязвимое владение: `captureOnArrival` такой узел не
      // отдаёт никогда, а счёт победы считает любой принадлежащий узел, так что игрока
      // с одним таким «владением» нельзя было бы устранить до конца матча.
      // Правило по СВОЙСТВУ вида, а не по имени `empty`: новый незахватываемый вид
      // получит его сам.
      if (!isCapturable(h.ctx.data, planet)) planet.owner = null;
      // Постройки сносит модуль стройки по этому событию — они его дом, и там же живут
      // выданный фортом гарнизон, очередь и оплаченные стройки. Снести их отсюда руками
      // значило бы оставить всё перечисленное сиротами (модули говорят только через шину).
      h.emit('station.destroyed', { planetId, owner });
    });

    // Захват крепости отдаёт орудия новому владельцу — вместе со зданиями, которые и так
    // переходят к нему. Взять узел, пока орудия живы, нельзя (`captureOnArrival` видит
    // чужой отряд), так что сюда попадает ровно случай «орудия выбиты, крепость взята»:
    // новый хозяин получает ядро и восстановленный при нём расчёт.
    api.on('planet.captured', (event, h) => {
      const p = event.payload as { planetId?: string };
      if (typeof p.planetId !== 'string') return;
      const planet = h.state.planets[p.planetId];
      if (planet) syncStationGuns(h, planet);
    });
  },
};
