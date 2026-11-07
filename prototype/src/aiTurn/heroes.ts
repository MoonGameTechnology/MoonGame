import { heroFlagshipUnit } from '../../../packages/shared-core/src/state/heroFlagship';
/**
 * ГЕРОИ В ХОДЕ СИЛЬНОГО БОТА (SLIM-3): подъём ростера, дерево навыков, железо корабля,
 * способности и ракетные мины — в прежнем порядке.
 */
import {
  activeHeroCount,
  heroActiveCap,
  abilityRange,
  getStance,
  heroCooldownKey,
  knownSkillNodes,
  moduleAllowed,
  slotUsage,
  isRocketMineFleet,
  rocketMinelayer,
  type Hero,
  type Player,
} from '../../../packages/shared-core/src/index';
import { bossFallen, heroNode } from '../../../packages/shared-core/src/state/heroes';
import {
  moveFleet,
  canTraverse,
  spawnHero,
  unlockHeroSkill,
  installHeroModule,
  castHeroAbility,
  stopFleet,
  deployRocketMine,
} from '../../../decisions/actions';
import { canOrder, canOrderAll } from '../protoKernel';
import { data } from '../gameData';
import { ownsModule } from './rules';
import type { AiTurn } from './turn';

// ═══ СИЛЬНЫЙ БОТ (AI-BAL-8): ГЕРОЙ ВХОДИТ В ИЗМЕРЕНИЕ ═══
// Диагноз кирпича: герой ПОСЕЯН во флоте каждого места (`matchSetup`) и исправно
// дерётся как корпус — но это и всё, что он делал. Бот не звал ни `hero.spawn`, ни
// `hero.skill.unlock`, ни `hero.fit`, ни `hero.ability`, поэтому целая ветка контента
// — три спящих героя ростера, два дерева навыков по четыре узла, три фитинга и весь
// диспетчер способностей — не участвовала в балансе НИ ОДНОЙ цифрой.
//
// Правила ниже намеренно минимальные, той же формы, что и правило технологий
// (AI-BAL-1): бот не «строит билд» — он просто не оставляет пустыми слоты, которые
// матч ему выдал. Что именно можно взять, решает САМО ЯДРО (ветка архетипа, `requires`,
// казна, кэп активных, кулдаун) — копии этих правил здесь нет, иначе первая же
// расходимость с модулем обернулась бы не ошибкой, а тихо изменившимся балансом.
export function heroOrders(bot: AiTurn, pl: Player): void {
  const { state, ai, out, army, defensive, capturable, d, base } = bot;
  // Порядок обхода — по id инстанса, а не по раскладке объекта: `hero:{место}:{n}`
  // сеет `matchSetup`, так что сортировка стабильна и один сид разыгрывается
  // одинаково (инвариант #1).
  // Павший босс (PVR-4.7) не возвращается: ядро отбивает о нём любой приказ
  // (`E_HERO_FALLEN`), и бот слал бы его каждый тик — подъём, оснащение, навыки.
  const roster = Object.values(state.heroes ?? {})
    .filter((x) => x.owner === ai && !bossFallen(x, data))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // «Развёрнут» ровно в том смысле, в каком это считает ядро (`activeHeroCount`):
  // жив И командует ЖИВЫМ кораблём. Протухший `fleetId` не считается — иначе бот
  // держал бы место в кэпе за героем, которого нет.
  const deployed = (x: Hero): boolean =>
    x.alive !== false && x.fleetId !== undefined && state.fleets[x.fleetId] !== undefined;
  const affordableCost = (cost: Record<string, number> = {}): boolean =>
    Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60);
  // Дешёвое вперёд, id последним ключом — тот же ДЕТЕРМИНИРОВАННЫЙ (а не «оптимальный»)
  // порядок, что у выбора технологии: перебор объекта дал бы разный порядок на разных
  // движках.
  const byPrice = (costOf: (id: string) => Record<string, number> | undefined) =>
    (a: string, b: string): number => {
      const sum = (c: Record<string, number> = {}): number =>
        Object.values(c).reduce((n, v) => n + v, 0);
      return sum(costOf(a)) - sum(costOf(b)) || (a < b ? -1 : a > b ? 1 : 0);
    };

  // 1. ПОДЪЁМ РОСТЕРА. Матч раздаёт каждому месту четырёх героев, но кораблём
  //    командует только главный — остальные лежат неразвёрнутыми и ждут `hero.spawn`.
  //    Кэп активных берётся из ядра (`heroActiveCap`), а не переписывается числом:
  //    иначе бот либо держал бы вторую копию правила, либо сыпал `E_HERO_CAP` каждые
  //    два часа. Респаун-кулдаун читается по тому же гроссбуху, что и гейт.
  if (base) {
    let room = heroActiveCap(state, ai, data) - activeHeroCount(state, ai);
    for (const x of roster) {
      if (room <= 0) break;
      if (deployed(x) || x.mobilization || (x.cooldowns?.respawn ?? 0) > state.time) continue;
      out.push(spawnHero(ai, x.id, base.id));
      room -= 1;
    }
  }

  // 2. ДЕРЕВО НАВЫКОВ — один узел за тик, как одна стройка за тик в экономике.
  //    Ветку узла против ветки архетипа и цепочку `requires` судит ядро; здесь их
  //    ЗЕРКАЛО ровно в той мере, чтобы не отдавать заведомо отбиваемый приказ.
  //    Изученное — купленное И врождённое (AUD-22): набор считает то же `knownSkillNodes`.
  for (const x of roster) {
    if (x.alive === false) continue;
    // Босс штурма (PVR-4.7) навыков ростера не учит: набор у него свой, объявленный
    // владельцем. Общий узел дерева (без ветки) ядро приняло бы, и бот за казну Роя
    // учил бы Левиафана чужим навыкам.
    if (x.archetype !== undefined && data.heroes[x.archetype]?.boss === true) continue;
    const branch = x.archetype !== undefined ? data.heroes[x.archetype]?.branch : undefined;
    const taken = knownSkillNodes(x.skills ?? [], x.archetype, data);
    const node = Object.keys(data.heroSkillTrees)
      .filter((id) => {
        const def = data.heroSkillTrees[id];
        if (!def || taken.has(id)) return false;
        if (def.branch !== undefined && def.branch !== branch) return false;
        if (!(def.requires ?? []).every((parent) => taken.has(parent))) return false;
        return affordableCost(def.cost);
      })
      .sort(byPrice((id) => data.heroSkillTrees[id]?.cost))[0];
    if (node !== undefined) {
      out.push(unlockHeroSkill(ai, x.id, node));
      break;
    }
  }

  // 3. ЖЕЛЕЗО КОРАБЛЯ — тоже по одному за тик (HPR-1.5.2, бывшие фиттинги). Ядро
  //    переоснащает героя только ВНЕ ПОЛЯ (`E_HERO_DEPLOYED`), поэтому здесь тот же
  //    отбор: развёрнутого не трогаем — иначе бот сыпал бы заведомо отбиваемые приказы
  //    каждый тик. Отсеки типизированы, допуск модуля судит его собственное правило;
  //    здесь их ЗЕРКАЛО ровно в той мере, чтобы приказ был законным.
  //    Цены у установки пока нет (её ставит HPR-1.6) — порядок «дешёвое вперёд»
  //    остаётся приоритетом «сначала простое», а не проверкой кошелька.
  //    Исключение — ракетный минёр (решение владельца 2026-10-08): пока его не везёт ни
  //    один герой места, ставится он (при ракетной доктрине — каждому герою,
  //    `minerEveryHero`). Самый дорогой модуль отсека по правилу «дешёвое
  //    вперёд» не доставался никому, а ветка ракетных техов (`damageScope: missile`)
  //    усиливает только мины — без минёра она для бота пуста. Проба `canOrder` — потому
  //    что на месте игрока (Хранитель) решает его арсенал: без модуля бот ставит прежнее.
  const minerAboard = roster.some((y) =>
    (y.modules ?? []).some((m) => data.modules[m]?.rocketMine !== undefined),
  );
  for (const x of roster) {
    if (x.fleetId !== undefined && state.fleets[x.fleetId] !== undefined) continue;
    const hull = heroFlagshipUnit(x, data);
    const hullDef = data.units[hull];
    if (!hullDef) continue;
    const bonus = x.grade !== undefined ? data.heroGrades[x.grade]?.moduleSlots : undefined;
    const installed = (x.modules ?? []).filter((m) => !!data.modules[m]);
    const used = slotUsage(installed, data);
    const fits = Object.keys(data.modules)
      .filter((id) => {
        const md = data.modules[id];
        if (!md || installed.includes(id) || !ownsModule(state, ai, id)) return false;
        // Маскировочное поле (SM-4.3) бот не ставит: выбор «дешёвое вперёд» раздал бы его
        // каждому герою, а играть скрытностью бот не умеет (план SM-4.3, 2026-11-03).
        if ((md.effects.stats.cloak ?? 0) > 0) return false;
        if (!moduleAllowed(hull, hullDef, md)) return false;
        return used[md.slot] < hullDef.slots[md.slot] + (bonus?.[md.slot] ?? 0);
      })
      .sort(byPrice((id) => data.modules[id]?.cost));
    const miner =
      minerAboard && !army.minerEveryHero
        ? undefined
        : fits.find(
            (id) =>
              data.modules[id]?.rocketMine !== undefined &&
              canOrder(state, installHeroModule(ai, x.id, id)) === null,
          );
    const mod = miner ?? fits[0];
    if (mod !== undefined) {
      out.push(installHeroModule(ai, x.id, mod));
      break;
    }
  }

  // 4. СПОСОБНОСТИ. Диспетчер ядра data-driven — значит и правило каста здесь по
  //    ТИПУ способности, а не по её id: новая способность того же типа поедет сама.
  //    Одна способность на героя за тик.
  for (const x of roster) {
    if (!deployed(x) || x.alive !== true) continue;
    const fleet = x.fleetId !== undefined ? state.fleets[x.fleetId] : undefined;
    const node = fleet ? state.planets[heroNode(state, x)] : undefined;
    if (!fleet || !node) continue;
    const fighting = fleet.battleId != null;
    for (const id of x.abilities ?? []) {
      if (typeof id !== 'string') continue;
      const def = data.heroAbilities[id];
      if (!def) continue;
      // Кулдаун читается ТЕМ ЖЕ ключом, что ведёт гейт (`heroCooldownKey`): ключ
      // общий на ТИП, поэтому rally и bulwark делят одно окно — и бот, не зная
      // этого, спамил бы `E_COOLDOWN` второй аурой каждый тик.
      if ((x.cooldowns?.[heroCooldownKey(def.type)] ?? 0) > state.time) continue;
      if (!affordableCost(def.cost)) continue;
      const reach = abilityRange(def);
      // Куда кастовать — решает ТИП:
      //  · `aura` (rally/bulwark) и `reveal` (scan) — боевые: они стоят чего-то
      //    только пока рядом дерутся, и оба бьют по узлу героя. У скана это не про
      //    туман (бот читает состояние целиком — та же причина, по которой ему не
      //    нужен `radar`, AI-BAL-2), а про ПСИ-ЛЕСТНИЦУ: взятые ступени превращают
      //    просвеченную зону в боевую (+урон врагу, −урон себе);
      //  · `annihilate` — по миру, который бот ОСАЖДАЕТ и всё равно не может взять
      //    (AI-BAL-7): размен «мир противника на мёртвый мир, богатый металлом» —
      //    единственный способ, которым в матче вообще появляется `dead_world`;
      //  · `devour` (PVR-4.7, «Поглощение мира» Левиафана) — осада чужого мира, который
      //    флот героя уже бомбардирует; идущую осаду заново не начинают, а флот
      //    осаждающего держит на месте обёртка Роя (`besieging`);
      //  · `temp_lane` — дорога туда, куда дороги нет: коридор к захватываемой цели
      //    в радиусе, не связанной с узлом героя ребром графа;
      //  · `recall` (домой) и маркеры `spawn_*` — НЕ кастуются. Отзыв выдёргивает
      //    героя с фронта ровно тогда, когда он нужнее всего, а маркеры вообще не
      //    кастуемы: ядро читает их наличием (`hero.spawn`), и каст ответил бы
      //    `E_NO_EFFECT`.
      let target: string | undefined;
      if (def.type === 'aura' || def.type === 'reveal') {
        if (!fighting) continue;
        target = reach > 0 ? node.id : undefined;
      } else if (def.type === 'annihilate') {
        if (!fleet.bombarding || node.owner === null || node.owner === ai) continue;
        target = node.id;
      } else if (def.type === 'devour') {
        if (x.siege || fighting || !fleet.bombarding || node.owner === null || node.owner === ai)
          continue;
        target = node.id;
      } else if (def.type === 'temp_lane') {
        const linked = new Set(node.links ?? []);
        const to = Object.values(state.planets)
          .filter(
            (p) =>
              p.id !== node.id &&
              p.owner !== ai &&
              capturable(p) &&
              !linked.has(p.id) &&
              canTraverse(state, ai, p.owner) &&
              d(node.position, p.position) <= reach,
          )
          .sort((a, b) => d(node.position, a.position) - d(node.position, b.position))[0];
        if (!to) continue;
        target = to.id;
      } else {
        continue;
      }
      out.push(castHeroAbility(ai, x.id, id, target));
      break;
    }
  }

  // 5. РАКЕТНЫЕ МИНЫ (решение владельца 2026-10-08). Мину ставит носитель минёра,
  //    стоящий посреди дороги, — и бот ставит её там, где герой и так едет: на дороге
  //    между своим миром и миром противника, с которым он воюет. Остановка и установка
  //    уходят ОДНИМ тиком и одной пробой (`canOrderAll`): тик бота — два часа, а мина
  //    взводится за четверть часа, так что к следующему тику она уже стоит. Тогда
  //    носитель едет дальше — общий бот ведёт флоты только из узлов, и вставший посреди
  //    дороги стоял бы там вечно. Режим `confirmed`: мина бьёт только опознанного
  //    противника, с которым война, — режим `any` стрелял бы по сигналу в тумане, то есть
  //    и по флоту соседа, с которым мир, и по приманке.
  //    Одна мина за тик: кулдаун и потолок держит ядро, а одна дорога — одна мина.
  if (!defensive) {
    const ord = state.ordnance;
    const atWarWith = (owner: string | null | undefined): boolean =>
      typeof owner === 'string' && owner !== ai && getStance(state, ai, owner) === 'war';
    const frontLane = (a: string, b: string): boolean => {
      const pa = state.planets[a]?.owner;
      const pb = state.planets[b]?.owner;
      return (pa === ai && atWarWith(pb)) || (pb === ai && atWarWith(pa));
    };
    const mined = (a: string, b: string): boolean =>
      Object.values(state.fleets).some((f) => {
        const e = f.edge;
        return (
          f.owner === ai &&
          !!e &&
          ((e.from === a && e.to === b) || (e.from === b && e.to === a)) &&
          isRocketMineFleet(f, data)
        );
      });
    let laid = false;
    for (const x of roster) {
      if (!deployed(x)) continue;
      const fleet = state.fleets[x.fleetId!]!;
      const layer = rocketMinelayer(fleet, data);
      if (!layer || fleet.battleId) continue;
      if (ord?.installations.some((m) => m.fleetId === fleet.id)) continue;
      const mv = fleet.movement;
      if (!mv) {
        const e = fleet.location === null ? fleet.edge : null;
        const on = e
          ? [moveFleet(ai, fleet.id, e.to), moveFleet(ai, fleet.id, e.from)].find(
              (a) => canOrder(state, a) === null,
            )
          : undefined;
        if (on) out.push(on);
        continue;
      }
      if (laid || !frontLane(mv.from, mv.to) || mined(mv.from, mv.to)) continue;
      if ((ord?.cooldowns[ai] ?? 0) > state.time || !affordableCost(layer.def.cost)) continue;
      const span = mv.arrivesAt - mv.departedAt;
      const t = span > 0 ? (state.time - mv.departedAt) / span : 0;
      if (t < 0.25 || t > 0.75) continue;
      const pair = [stopFleet(ai, fleet.id), deployRocketMine(ai, fleet.id, 'confirmed')];
      if (canOrderAll(state, pair) !== null) continue;
      out.push(...pair);
      laid = true;
    }
  }
}
