/**
 * ФЛОТЫ В ХОДЕ БОТА (SLIM-3): слияние стоящих вместе, отступление из проигранного боя и курс
 * каждого свободного флота — погрузка, гарнизон, штурм, осада, цель и подвоз.
 */
import {
  fleetHoldFree,
  getStance,
  previewBattle,
  type Battle,
  type CombatantRef,
  type Fleet,
  type Planet,
  type UnitStack,
} from '../../../packages/shared-core/src/index';
import { heroByFleet } from '../../../packages/shared-core/src/state/heroes';
import { provinceScore } from '../../../packages/shared-core/src/state/sectorKind';
import {
  assaultFleet,
  bombardFleet,
  canTraverse,
  loadArmy,
  mergeFleet,
  moveFleet,
  retreatFleet,
  splitFleet,
  unloadArmy,
} from '../../../decisions/actions';
import { confidentGroundWin } from '../../../decisions/groundForecast';
import { garrisonNeed, pickForGarrison, spareGround } from '../../../decisions/garrisonPolicy';
import { data } from '../gameData';
import { decisionNoise } from './rules';
import type { AiTurn } from './turn';

/** С какого размера кулак сильного бота делится надвое при отплытии (AI-BAL-7). Ниже —
 *  ударная группа и так на пределе: её порог выхода в рейд равен трём корпусам. */
const SPLIT_MIN = 6;
/** …и до какого числа флотов у места это вообще разрешено. Потолок ниже боевого предела
 *  постройки (8): деление не должно возвращать рой одиночек, вылеченный в self-play M4. */
const SPLIT_FLEET_CAP = 6;

/**
 * ОХОТА ОТСТАЮЩЕГО (снежный ком, 2026-09-28) — сколько «весит» цель, когда её выбирает
 * флот места, которое ОТСТАЁТ по очкам на войне. Курс берётся по «расстояние ÷ вес», а
 * не просто к ближайшему.
 *
 * Зачем. Во второй половине матча территория у бота ходит по кругу: миры без гарнизона
 * лидер и отстающий отбирают друг у друга ПОРОВНУ (замер: ~31 мир за матч каждый), и
 * отставание не сокращается никогда. Отстающий, который идёт к ближайшему, меняет свою
 * 10-очковую туманность на чужую такую же. Отстающий, который идёт к ценному, отбирает
 * планеты (50 очков) — и ком тает: snowball 79/73% → 60/64%, разрыв ~420 → ~280.
 *
 * Почему только отстающий. То же правило у ОБОИХ дало 68/69% при растущем разрыве:
 * лидер тоже начинает охотиться, и его большее хозяйство опять решает. Асимметрия — не
 * поблажка, а доктрина: кто впереди, держит; кто позади, бьёт туда, где больнее.
 *
 * Вес = очки провинции / 10 в коридоре [1, 5] (планета 5, прочее 1). Мир с гарнизоном,
 * который этим десантом наверняка не взять, весит в пять раз меньше: лететь к нему —
 * значит встать на орбите и ждать.
 */
export function huntWeight(target: Planet, landing: readonly UnitStack[]): number {
  let w = Math.min(5, Math.max(1, provinceScore(data, target) / 10));
  const guarded = target.garrison.some((st) => st.count > 0);
  if (guarded && !confidentGroundWin(landing, target.garrison, data)) w /= 5;
  return w;
}

// Consolidate BEFORE moving (self-play M4): two idle fleets sharing a location fuse
// into one — without this, battle remnants and rally leftovers accumulate into a
// hundreds-strong swarm of one-ship fleets that grinds the whole sim (and feeds
// enemy AA one hull at a time). The merged fleet sorties on the next tick.
export function consolidateFleets(bot: AiTurn): void {
  const { state, ai, pinned, out, shipCount, expandFleets, skipMove } = bot;
  // Дозорный маяка и посты сети стоят особняком: слей бот такой флот с проходящим — и
  // якорь ждал бы слияния, которое обёртка `aiOrders` не пропустит, то есть стоял бы вечно.
  const byLoc = new Map<string, Fleet[]>();
  for (const f of expandFleets) {
    if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
    if (pinned.has(f.id)) continue;
    const group = byLoc.get(f.location);
    if (group) group.push(f);
    else byLoc.set(f.location, [f]);
  }
  for (const group of byLoc.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => shipCount(b) - shipCount(a));
    const anchor = group[0]!;
    // Считается НАРАСТАЮЩИМ итогом, а не по состоянию на начало тика: приказы
    // применяются подряд, и первый же влившийся геройский флот делает якорь
    // геройским. Снимок пропустил бы второе слияние — оно отбилось бы при уже
    // поставленном `skipMove`, то есть вернуло бы ту же вечную стоянку.
    let anchorHasHero = !!heroByFleet(state, anchor.id);
    let merged = false;
    for (let k = 1; k < group.length; k++) {
      const from = group[k]!;
      // ПРАВИЛО «ОДИН ГЕРОЙ НА ФЛОТ» (HERO-10, резолюция владельца «как в HoMM»): ядро
      // отбивает слияние ДВУХ геройских флотов кодом `E_TWO_HEROES`. Безгеройский к
      // герою присоединить можно — это обычное усиление, герой в итоге один.
      //
      // Бот про это правило не знал, и цена оказалась не косметической (AI-BAL-13): два
      // геройских флота в одной точке отбивались каждый тик, а `skipMove` ставился им
      // ВСЁ РАВНО — оба стояли навсегда. Замер при CONV-12b: боёв 12370 → 119, наземных
      // 7073 → 0. Остановка боевой части игры, а не дрейф баланса.
      const fromHasHero = !!heroByFleet(state, from.id);
      if (anchorHasHero && fromHasHero) continue;
      out.push(mergeFleet(ai, from.id, anchor.id));
      skipMove.add(from.id);
      merged = true;
      if (fromHasHero) anchorHasHero = true; // герой переехал в якорь вместе с флотом
    }
    // Ход гасится ТОЛЬКО тому, чьё слияние действительно отправлено: якорь, в который
    // никто не влился, обязан лететь сам, а не ждать роста, которого не будет.
    if (merged) skipMove.add(anchor.id); // вырастет сейчас, вылетит на следующем тике
  }
}

// ═══ СИЛЬНЫЙ БОТ (AI-BAL-7): ФЛОТ УМЕЕТ ПРОИГРАТЬ БОЙ ═══
// Диагноз кирпича: из боевого репертуара ядра бот звал только `fleet.engage` и
// `fleet.assault`, а `fleet.retreat` — НИКОГДА. Значит каждый бой в измерении шёл до
// полного уничтожения одной из сторон: размен всегда полный, «потрёпанный флот» как
// состояние не существовал, и вся ветка ядра вокруг отступления (пошлина в 40%
// ТЕКУЩЕГО корпуса, скоростная фора беглеца `retreatHasteUntil`, освобождение
// противника) не участвовала в балансе ни одной цифрой.
//
// Правило одно и БЕЗ порога-настройки: проигрываю — ухожу. Пошлина забирает 40% того,
// что осталось, и по построению никого не добивает (`applyRetreatToll`: 0.6 × живой
// пул остаётся живым), а проигранный бой забирает 100% — выбор между ними не требует
// ни коэффициента, ни калибровки. Выигранный бой держится даже дорогой ценой: размен,
// который заканчивается взятым узлом, это и есть плата за узел.
//
// Прогноз — тот самый `previewBattle`, которым уже судит «Хранитель»
// (`stewardGuard.ts`), а не вторая копия правила: базовая модель без хуков
// `combat.damage`, то есть эвристика, а не оракул. Роли в прогнозе сохраняются
// (атакующий бьёт `attack`, стоящая сторона отвечает `defense`) — перепутать их
// значило бы прогнозировать другой бой.
//
// Уход в том же тике ОБЯЗАТЕЛЕН, и это не украшение. `fleet.retreat` только распускает
// бой: флот остаётся стоять там же, рядом с тем же противником, который в тот же миг
// освобождён. Оставшийся стоять беглец был бы втянут заново и платил бы пошлину каждые
// два часа, пока не сточится в ноль, — ровно та «драка до нуля», от которой уводит
// кирпич, только медленнее. Скоростная фора беглеца выдана ядром именно под этот шаг.
export function retreatLosingFleets(bot: AiTurn): void {
  const { state, ai, out, hand, d, base } = bot;
  const sideUnits = (ref: CombatantRef): UnitStack[] => {
    if (ref.kind === 'garrison') return state.planets[ref.planetId]?.garrison ?? [];
    // ROS-1.5: плацдарм держит мир, а не флот — оценивается так же, как гарнизон.
    if (ref.kind === 'beachhead')
      return (
        state.planets[ref.planetId]?.beachheads?.find((b) => b.owner === ref.owner)?.units ?? []
      );
    const other = state.fleets[ref.fleetId];
    if (!other) return [];
    return ref.kind === 'landing' ? (other.landing ?? []) : other.units;
  };
  const isThisFleet = (ref: CombatantRef, fleetId: string): boolean =>
    ref.kind === 'fleet' && ref.fleetId === fleetId;
  for (const f of Object.values(state.fleets)) {
    if (f.owner !== ai || f.battleId == null) continue;
    const battle: Battle | undefined = state.battles[f.battleId];
    if (!battle) continue;
    // Отступить может только ОРБИТАЛЬНАЯ сторона: сошедший на грунт десант ядро не
    // выпускает (`E_CANNOT_RETREAT`), так что приказ был бы чистым отказом.
    // MSB-1: своя сторона ищется СРЕДИ СТОРОН, враг — то, что не она. На двух это
    // прежнее «атакующий или обороняющийся», при N — единственная верная форма вопроса.
    const mine = battle.sides.find((s) => isThisFleet(s.ref, f.id));
    if (!mine) continue;
    const weAttack = mine.role === 'attacker';
    const foeSide = battle.sides.find((s) => s !== mine);
    if (!foeSide) continue;
    const foe = sideUnits(foeSide.ref);
    if (!foe.some((s) => s.count > 0)) continue; // добивать уже некого — бой наш
    const forecast = weAttack
      ? previewBattle(f.units, foe, data)
      : previewBattle(foe, f.units, data);
    if (forecast.outcome !== (weAttack ? 'defender' : 'attacker')) continue;
    // Слабый профиль замечает проигранный бой не всегда (`WEAK_HANDICAP.missRetreat`).
    if (decisionNoise(state, ai, `retreat:${f.id}`) < hand.missRetreat) continue;
    out.push(retreatFleet(ai, f.id));
    // Куда бежать: ближайший СВОЙ мир, а при перехвате на лейне (узла под флотом нет)
    // — домой. Некуда — флот всё равно выходит из боя: пошлина дешевле уничтожения.
    const from = f.location != null ? state.planets[f.location] : undefined;
    let haven: Planet | null = null;
    let havenD = Infinity;
    if (from) {
      for (const p of Object.values(state.planets)) {
        if (p.owner !== ai || p.id === from.id) continue;
        const dd = d(from.position, p.position);
        if (dd < havenD) {
          havenD = dd;
          haven = p;
        }
      }
    }
    const refuge = haven ?? (base && base.id !== f.location ? base : null);
    if (refuge) out.push(moveFleet(ai, f.id, refuge.id));
  }
}

/** Курс каждого свободного флота места. */
export function expansionMoves(bot: AiTurn): void {
  for (const f of bot.expandFleets) fleetOrders(bot, f);
}

function fleetOrders(bot: AiTurn, f: Fleet): void {
  const { state, ai, out, raidZone, inReach, hand, skilled, militiaUnit, isShipUnit, capturable, neediestWorld, d, warFooting, base, shipCount, reconBare, neutralGuarded, trailing, ownFleets, skipMove } = bot;
  if (f.owner !== ai || f.location == null || f.movement || f.battleId) return;
  // Высадка штурмом и выгрузка идут по таймеру (решение владельца 2026-09-26): флот стоит,
  // пока десант не сошёл, — любой приказ ему был бы отказом, а курс отменил бы выгрузку.
  if (f.assaultLanding || (f.unloading ?? []).length > 0) return;
  if (skipMove.has(f.id)) return;
  // ═══ СИЛЬНЫЙ БОТ (AI-BAL-3): десант и штурм ═══
  // Игровой бот не делает НИ ТОГО, НИ ДРУГОГО, и вот почему вторая фаза захвата
  // (орбита → высадка, GDD §7.4) в измерении баланса не участвовала вовсе:
  //   • приказ `fleet.assault` бот не отдавал НИКОГДА. В сети штурм ведёт драйвер
  //     `serverAutoAssaultActions`, а тот ходит только по флотам, которым ИГРОК
  //     включил авто-штурм (`order.auto`) — у бота такого флага нет ни одного;
  //   • трюм он грузил только на войне и только двумя ополченцами.
  // Итог в батче: гарнизонный мир для бота просто НЕПРОХОДИМ — флот прилетает,
  // `captureOnArrival` пропускает защищённый мир, и флот стоит на орбите до конца
  // матча. Игровой профиль не тронут: это лаборатория.
  if (skilled && base && landingOrders(bot, f, f.location, base)) return;
  // Strike groups, not dribbles (self-play M4): auto-rally pools each new ship into
  // the IDLE rally fleet at its build world — but only while one is parked there.
  // Sending every single-ship fleet out at once therefore orphaned the rally point,
  // spawned a fresh one-ship fleet per build (hundreds of fleets, the sim ground to
  // a halt) and fed hulls into enemy AA one at a time. At war, ships HOLD at the
  // home rally point until a strike group has formed; peacetime keeps the old
  // race-to-claim behaviour (speed is everything, there is nothing to fight).
  if (warFooting && f.location === base?.id) {
    if (shipCount(f) < 3) return;
    // Lift a landing party before the sortie: only ground troops can take a
    // garrisoned world (two-phase capture), so a strike group without a landing
    // can raid provinces but never resolve the war.
    // ПОДЪЁМ ЗАНИМАЕТ ЧАС (CARGO-1), и вылет его ОТМЕНЯЕТ — поэтому «погрузить и
    // улететь одним тиком» больше не работает: группа ждёт свой десант дома и
    // уходит следующим тиком уже с ним. Без ожидания она улетала бы пустой и до
    // конца матча не могла бы взять ни одного гарнизонного мира.
    if ((f.loading ?? []).length > 0) return; // подъём идёт — стоим
    // ПОЛ ГАРНИЗОНА (правило владельца №6) держит и этот путь: пара бойцов эскорта
    // не должна опустить мир ниже того, что он обязан оставить себе. Двойка здесь —
    // не доктрина, а минимальный эскорт, и её кап остаётся как был.
    const spareMilitia = spareGround(base, data).find((s) => s.unit === militiaUnit);
    const hasLanding = (f.landing ?? []).some((s) => s.count > 0);
    const lift = Math.min(
      2,
      spareMilitia?.count ?? 0,
      Math.floor(fleetHoldFree(state, f, data) / (data.units[militiaUnit]?.stats.cargoSize ?? 1)),
    );
    if (!hasLanding && lift > 0) {
      out.push(loadArmy(ai, f.id, militiaUnit, lift));
      return; // час подъёма — вылет следующим тиком
    }
  }
  const here = state.planets[f.location];
  if (!here) return;
  // Разведчикам без десанта брать нечего, а трюма у них нет (решение владельца
  // 2026-10-17), так что и дома взять бойца не во что: флот стоит, где стоит, —
  // радарным пикетом, а не в очереди отбиваемых штурмов.
  if (reconBare(f)) return;
  let best: Planet | null = null;
  let bestD = Infinity;
  let second: Planet | null = null;
  let secondD = Infinity;
  // ТАЙ-БРЕЙК ПРИ РАВНЫХ ЦЕЛЯХ (BAL-1). На прежней, кривой карте равные расстояния были
  // редкостью, и «кто первый в переборе, тот и цель» ничего не решало. Карта-«колесо»
  // симметрична, поэтому равенство стало ОБЫЧНЫМ делом — и скрытый тай-брейк по порядку
  // `Object.values(state.planets)` превратился в систематическую фору: узлы сектора 0
  // лежат в этом порядке первыми, так что место, стартующее в нулевом секторе, всегда
  // забирало спорную цель. Замер: при идентичных по метрикам стартах сектор 0 брал 70%
  // побед. Идеальная карта не создала перекос, она ОБНАЖИЛА его в боте.
  // Лечение — seeded тай-брейк (только тест-профиль, как и весь разброс AI-BAL-5):
  // среди равных целей выбор идёт по шуму, а не по раскладке объекта.
  const tieBreak = (p: Planet): number =>
    skilled ? decisionNoise(state, ai, `tie:${f.id}:${p.id}`) : 0;
  // Охота отстающего — у обоих профилей обычного места (игровой бот, 2026-09-28).
  const hunting = skilled && warFooting && trailing;
  const weight = (p: Planet): number => (hunting ? huntWeight(p, f.landing ?? []) : 1);
  for (const p of Object.values(state.planets)) {
    if (p.id === here.id || p.owner === ai || !capturable(p)) continue;
    if (!canTraverse(state, ai, p.owner)) continue; // a peace-locked target — leave it be
    if (!inReach(p)) continue; // за угодьями клана пираты не ходят
    // Ничью планету с гарнизоном, которую этот десант наверняка не возьмёт, не
    // выбирают, иначе флот повиснет на её орбите до конца матча.
    if (
      p.owner === null &&
      p.garrison.some((st) => st.count > 0) &&
      !confidentGroundWin(f.landing ?? [], p.garrison, data)
    )
      continue;
    // Равные цели (в пределах пикселя) разводятся шумом, а не порядком перебора.
    const dd = d(here.position, p.position) / weight(p) + tieBreak(p);
    if (dd < bestD) {
      secondD = bestD;
      second = best;
      bestD = dd;
      best = p;
    } else if (dd < secondD) {
      secondD = dd;
      second = p;
    }
  }
  // AI-BAL-5, точка разброса №1: ТЕСТ-бот иногда идёт ко ВТОРОЙ по близости цели.
  // Строгий выбор ближайшей — главная причина, по которой два матча с разных сидов
  // разыгрывались одинаково: пути флотов совпадали с первого тика. Вторая цель берётся
  // только если она сопоставима по дальности (не дальше 2×), то есть бот остаётся
  // жадным — расходятся лишь РАВНОЦЕННЫЕ ветки, а не качество игры.
  if (
    skilled &&
    second &&
    secondD <= bestD * 2 &&
    decisionNoise(state, ai, `target:${f.id}`) < hand.wrongTarget
  ) {
    best = second;
  }
  // ═══ СИЛЬНЫЙ БОТ (AI-BAL-7): КУЛАК УМЕЕТ ДЕЛИТЬСЯ ═══
  // `fleet.split` бот не звал никогда, и следствие было структурным, а не «забыли
  // правило»: блок слияния выше сводит всё стоящее на узле в ОДИН флот (без него рой
  // одиночек кладёт симуляцию — self-play M4), а обратной операции у бота не
  // существовало. Поэтому вся тактика измерения свелась к одному кулаку: сколько бы
  // кораблей у места ни было, они ходили одной стопкой на одну цель, а вторая,
  // равноценная по дальности, ждала своей очереди.
  //
  // Делить осмысленно ровно в один момент — когда кулак ОТЧАЛИВАЕТ со своего мира и
  // целей у него две. Тогда отделённая половина остаётся стоять, исходный флот в этом
  // же тике уходит, и слить их обратно в следующем тике уже некому: слияние берёт
  // только стоящие рядом флоты, а первый из них в пути. Половина, оставшаяся дома,
  // выберет цель сама — расстояния для неё считаются заново.
  // Обе границы стоят против роя, который лечил M4: делится только КРУПНЫЙ кулак и
  // только пока флотов у места немного.
  if (
    skilled &&
    best &&
    here.owner === ai &&
    second &&
    shipCount(f) >= SPLIT_MIN &&
    ownFleets < SPLIT_FLEET_CAP
  ) {
    const take: Array<{ unit: string; count: number }> = [];
    for (const st of f.units) {
      // Флагман героя не отделяется: сущность героя привязана к ИСХОДНОМУ флоту по
      // `fleetId`, и ядро такой раскол отбивает (`E_HERO_UNIT`). Одиночный корпус
      // тоже остаётся — делить нечего.
      if (st.count < 2 || !isShipUnit(st.unit)) continue;
      if (data.units[st.unit]?.traits.includes('hero')) continue;
      take.push({ unit: st.unit, count: Math.floor(st.count / 2) });
    }
    if (take.length > 0) out.push(splitFleet(ai, f.id, take));
  }
  // ═══ КУРС ПОДВОЗА (правило владельца №4, вторая половина) ═══
  // ЗАВОЗ ПО ДОРОГЕ, а не отдельная экспедиция. Первая версия правила разворачивала
  // флот, только если он НЕ возьмёт ближайшую цель, — и замер показал, почему этого
  // мало: гружёный флот стоял на нуждающемся мире 19 раз за 1002 тика, а в пути с
  // десантом был 1574 раза. Возить было чем и что, но маршруты туда не вели.
  //
  // Теперь крюк делается, когда свой голодный мир БЛИЖЕ цели: флот завозит гарнизон
  // и следующим тиком идёт дальше — цена крюка ограничена тем, что он короче пути,
  // который флот и так собирался пройти. Второй случай прежний: цель, которую этим
  // десантом всё равно не взять, перестаёт быть целью.
  //
  // Роли «подвоз» нет, и памяти о задании тоже: оба условия выводятся из состояния
  // КАЖДЫЙ тик, а «хватит ли на цель» спрашивает ту же `confidentGroundWin`, которой
  // меряет себя сам штурм. Уверенный флот с далёким голодным миром идёт воевать.
  if (skilled && best && (f.landing ?? []).some((st) => st.count > 0)) {
    const needy = neediestWorld(here.position);
    if (needy && needy.id !== here.id) {
      const closer = d(here.position, needy.position) < d(here.position, best.position);
      if (closer || !confidentGroundWin(f.landing ?? [], best.garrison, data)) best = needy;
    }
  }
  // Взять нечего тем, что в трюме, — домой, за десантом.
  if (!best && neutralGuarded && base && f.location !== base.id && skilled)
    best = base;
  // Пиратский флот за пределами угодий (застрял там до потолка, отступил) идёт к логову.
  if (!best && raidZone && base && !raidZone.has(f.location)) best = base;
  if (best) out.push(moveFleet(ai, f.id, best.id));
}

/** Сильный бот у мира `at`: погрузка, гарнизон, подвоз, штурм, осада. `true` — флот этот ход
 *  занят (грузится, отдаёт войска, штурмует или осаждает), и курса ему не дают. */
function landingOrders(bot: AiTurn, f: Fleet, at: string, base: Planet): boolean {
  const { state, ai, out, inReach, capturable, orbitalLayer, assaultTargetFor, neediestWorld, warFooting, reconBare, neutralGuarded } = bot;
  const here0 = state.planets[at];
  // (а) Погрузка ДОМА — ТОЛЬКО ПОД АТАКУ (правило владельца №5, 2026-09-16:
  //     «загружает наземные юниты только когда целенаправленно нападает на планеты
  //     врага»). Раньше грузили и в мирное время; довод был «пустой трюм у стены
  //     гарнизона означает, что флот долетит и встанет». Довод верен, а цена его —
  //     войска, которые месяцами катаются в трюме и пропадают ВМЕСТЕ с флотом:
  //     гибель корпусов стирает `fleet.landing` целиком (`combat.ts`, удаление
  //     флота), отдельного броска у десанта нет. В мирное время брать нечего —
  //     пустой мир занимается прилётом, и войска ему не нужны. Исключение — ничья
  //     планета под ополчением (BAL-10, `NEUTRAL_PLANET_MILITIA`): её тоже берут
  //     штурмом, поэтому, пока такие есть, флот грузится и без войны.
  //
  //     СКОЛЬКО БРАТЬ, решает `spareGround` (правило №6: досуха не вычёрпывать,
  //     пол растёт с развитостью мира). Отдаёт он УДАРНЫЕ рода, оставляя дома
  //     оборонительные, — танк полезнее на чужой земле, ополченец на своей.
  //     ПОДЪЁМ ЗАНИМАЕТ ЧАС (CARGO-1), а вылет его ОТМЕНЯЕТ: флот, который
  //     грузится, этот тик СТОИТ дома, иначе улетел бы с пустым трюмом.
  if (here0 && here0.id === base.id && (warFooting || neutralGuarded)) {
    if ((f.loading ?? []).length > 0) return true; // подъём идёт — ждём его
    let free = fleetHoldFree(state, f, data);
    let ordered = false;
    for (const st of spareGround(here0, data)) {
      if (free <= 0) break;
      const size = data.units[st.unit]?.stats.cargoSize ?? 1;
      const take = Math.min(st.count, Math.floor(free / size));
      if (take > 0) {
        out.push(loadArmy(ai, f.id, st.unit, take));
        free -= take * size;
        ordered = true;
      }
    }
    if (ordered) return true; // час подъёма — вылет следующим тиком
  }
  // (а2) ГАРНИЗОН НА ЗАНЯТОМ МИРЕ (AI-BAL-2, доращено подвозом 2026-09-16). Мир без
  //      войск берётся ПРИЛЁТОМ — `captureOnArrival` не смотрит ни на здания, ни на
  //      их оборонный бонус, только на `garrison.some(count > 0)`. Отсюда карусель
  //      базовой линии: 113 захватов прилётом за матч, миры перекидываются без
  //      единого выстрела.
  //
  //      РАНЬШЕ ССАЖИВАЛИ РОВНО ОДНОГО, и довод был «остальной десант нужен самому
  //      флоту». Довод верен только наполовину: нужен ровно тот десант, которым флот
  //      РЕАЛЬНО возьмёт свою цель, а всё сверх того он просто возит — и теряет
  //      вместе с корпусами. Поэтому ссаживается столько, сколько мир не добирает до
  //      пола (правило владельца №4), но не глубже, чем позволяет уверенность в
  //      ближайшей цели: ту же `confidentGroundWin` спрашивает и сам штурм, так что
  //      разойтись эти два ответа не могут.
  if (here0 && here0.owner === ai && here0.id !== base.id && capturable(here0)) {
    const need = garrisonNeed(here0, data);
    const carried = (f.landing ?? []).filter((st) => st.count > 0);
    if (need > 0 && carried.length > 0) {
      const target = assaultTargetFor(f);
      let gave = false;
      for (const give of pickForGarrison(carried, need, data)) {
        // Оставшееся обязано взять цель. Нет цели — отдаём без оглядки: возить
        // десант некуда, а мир без гарнизона перекидывают прилётом.
        const left = carried.map((st) =>
          st.unit === give.unit ? { ...st, count: st.count - give.count } : { ...st },
        );
        if (target && !confidentGroundWin(left, target.garrison, data)) break;
        out.push(unloadArmy(ai, f.id, give.unit, give.count));
        gave = true;
      }
      // ВЫГРУЗКА ЗАНИМАЕТ ЧАС (как подъём), а вылет её ОТМЕНЯЕТ: флот, отдавший войска
      // миру, этот тик стоит, иначе улетел бы с ними же на борту.
      if (gave) return true;
    }
  }
  // (а3) ПОДВОЗ ПОДКРЕПЛЕНИЯ — вторая половина правила владельца №4 (2026-09-16).
  //      Замер показал, что войска у бота ЕСТЬ, они просто лежат не там: за 78
  //      суточных срезов 179 миров стояли ниже пола на 2432 очка обороны суммарно,
  //      при излишке 23004 очка на 1619 других миров. Строить на месте умеет не
  //      каждый — 63 из 179 миров были без казармы вовсе.
  //
  //      Грузится ИЗЛИШЕК со своего мира, и только НЕ ДОМА: дома трюм наполняет
  //      правило (а) под атаку, и два правила на один трюм передрались бы за него.
  //      Пустой трюм в условии — граница, из-за которой подвоз не может разоружить
  //      ударную группу: флот с десантом на борту он не трогает вовсе.
  if (
    here0 &&
    here0.owner === ai &&
    here0.id !== base.id &&
    !(f.landing ?? []).some((st) => st.count > 0) &&
    (f.loading ?? []).length === 0 &&
    neediestWorld(here0.position) !== undefined
  ) {
    let free = fleetHoldFree(state, f, data);
    let ordered = false;
    for (const st of spareGround(here0, data)) {
      if (free <= 0) break;
      const size = data.units[st.unit]?.stats.cargoSize ?? 1;
      const take = Math.min(st.count, Math.floor(free / size));
      if (take > 0) {
        out.push(loadArmy(ai, f.id, st.unit, take));
        free -= take * size;
        ordered = true;
      }
    }
    if (ordered) return true; // час подъёма — курс следующим тиком
  }
  // (б) Штурм с орбиты. Правила штурма называет ЯДРО (`assaultPlanet`), здесь
  //     только повод не сыпать заведомо отбиваемым приказом: чужой захватываемый
  //     мир, война/нейтралитет и чем его брать.
  //     «Чем брать» — ДВА разных случая, и раньше учитывался только первый:
  //     живой гарнизон берётся десантом из трюма, а ПУСТОЙ занимается и без него
  //     (`assaultPlanet`: `undefined → occupy`). Второй случай не выдумка — мир
  //     пустеет уже под флотом (гарнизон добит наземным боем или ПКО-разменом), а
  //     `captureOnArrival` больше не сработает: он судит по ПРИЛЁТУ, а флот давно
  //     прилетел. Без этой ветки такой мир не берёт никто, и осада ниже подменила
  //     бы собой бесплатный захват.
  if (
    here0 &&
    f.orbit === 'near' &&
    here0.owner !== ai &&
    capturable(here0) &&
    canTraverse(state, ai, here0.owner) &&
    inReach(here0) &&
    !reconBare(f) &&
    (!here0.garrison.some((st) => st.count > 0) ||
      // ПРАВИЛО ВЛАДЕЛЬЦА №2 (2026-09-16): штурмовать, только будучи УВЕРЕННЫМ, что
      // наземные силы возьмут гарнизон. Раньше хватало любого бойца в трюме — и
      // десант из двух ополченцев ложился под ротой тяжёлой пехоты, не сдвинув
      // ничего. Гарнизон читается ПРЯМО: флот стоит в ближней орбите, мир опознан,
      // и разведданные здесь — само наблюдение (правило №1 соблюдено по построению).
      confidentGroundWin(f.landing ?? [], here0.garrison, data))
  ) {
    out.push(assaultFleet(ai, f.id));
    return true; // берём ЭТОТ мир, а не улетаем к следующему
  }
  // (в) ОСАДА (AI-BAL-7). Мир под флотом взять нечем — но стоять над ним МОЛЧА
  //     нельзя: ПКО бьёт по всему враждебному в near-орбите независимо от того,
  //     бомбит гость или нет (`runOrbital` — залп ищет `nearOrbitHostile`, а не
  //     бомбардировщика), так что молчащий флот платит ту же цену и не получает
  //     ничего. Бомбардировка — единственное, что он может сделать имеющимся
  //     оружием: она крошит постройки под собой (`planet.bombarded` →
  //     `damageBuildings`), прореживает гарнизон до последнего бойца (ROS-1.6) и
  //     морозит владельцу производство и стройку
  //     (`bombardedPlanets`). Целый пласт ядра — осада — до сих пор не участвовал
  //     в измерении ни разу.
  //     Это не НОВАЯ стоянка, а смысл уже существующей: флоту, которому нечем взять
  //     мир, целеуказание и раньше выдавало ближайшую чужую цель — ту самую, под
  //     которой он стоит (расстояние 0), — и `fleet.move` в собственную клетку
  //     возвращался `E_SAME_LOCATION` каждые два часа до конца матча.
  if (
    here0 &&
    f.orbit === 'near' &&
    here0.owner !== null &&
    here0.owner !== ai &&
    capturable(here0) &&
    orbitalLayer(here0) && // ядро бомбит только планету и космическую крепость
    getStance(state, ai, here0.owner) === 'war' && // ядро бомбит только врага
    f.units.some((st) => st.count > 0)
  ) {
    if (f.bombarding !== true) out.push(bombardFleet(ai, f.id, true));
    return true; // осада — это стоянка НАД целью, а не пауза перед перелётом
  }
  return false;
}
