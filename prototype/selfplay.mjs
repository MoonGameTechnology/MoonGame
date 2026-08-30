// M4 self-play balance harness (docs/metrics-roadmap.md): AI vs AI on the REAL
// kernel, headless, seeded, deterministic — N matches → a balance table in one
// command. Mirrors the netserver driver loop (advance the clock, let each seat's
// AI issue orders every ~2 game-hours) with no server/network/DOM at all.
//
//   pnpm run selfplay            # 20 matches, base seed "sp"
//   pnpm run selfplay 200        # 200 matches
//   pnpm run selfplay 200 tag7   # 200 matches, another seed family
//
// Fairness controls per match index i: starts swap on i%2, the ORDERED faction pair
// cycles on (i>>1)%12 — so "win rate by slot", "by faction" and "by start" separate cleanly.
import { build } from 'esbuild';

const N = Math.max(1, Number(process.argv[2] ?? 20) || 20);
const BASE_SEED = process.argv[3] ?? 'sp';

const res = await build({
  entryPoints: ['prototype/src/game.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  write: false,
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', res.outputFiles[0].text)(mod, mod.exports, () => ({}));
const { newGame, kernel, data, aiOrders, scoreParts, HOUR, DAY, START_CANDIDATES } = mod.exports;

const STEP = 2 * HOUR; // the AI decision cadence (mirrors the netserver driver)

// AI-BAL-12: ЧЕТЫРЕ дома вместо двух. До этого кресла занимала константа azure/crimson,
// поэтому `amber` (+15% скорости флота) и `violet` (+5%/+5%) не участвовали ни в одном
// прогоне ни разу — про них не было ни одной цифры, а «фракции сравнимы» (BAL-2) было
// сказано ровно про двух из четырёх.
//
// Пара берётся ПЕРЕБОРОМ по индексу матча, а не хешем сида: перебор равномерен по
// построению, хеш — лишь в пределе, а на 300 матчах предел ещё не наступил. Пары
// УПОРЯДОЧЕННЫЕ (4×3 = 12): порядок решает, кто садится в p1, а слотовый перекос —
// самостоятельная величина отчёта, и смешивать его с фракционным нельзя.
const FACTION_IDS = Object.keys(data.factions ?? {});
const FACTION_PAIRS = FACTION_IDS.flatMap((a) => FACTION_IDS.filter((b) => b !== a).map((b) => [a, b]));

// ДВУХНЕДЕЛЬНАЯ СЕССИЯ БЕЗ ДОСРОЧНОЙ ПОБЕДЫ (заказ владельца 2026-08-26). Раньше прогон
// кончался порогом очков — и кончался на 4-м дне: `score` был исходом 100% матчей, а
// поскольку `scoreValue` есть и у провинций, и у зданий, вперёд вырывался тот, кто
// раньше занял территорию, после чего партия просто добегала до порога. Измерение от
// этого было БИНАРНЫМ: «выиграл/проиграл» и ничего про то, НАСКОЛЬКО.
//
// Теперь у каждого матча одинаковая длина — 14 игровых дней, — и в конце ранжирование по
// очкам (`victory` завершает матч причиной `timeout`, победитель = высший счёт). Это
// делает сравнимыми условия: одни и те же две недели у всех, разный итоговый счёт.
//
// Как это выражено: досрочные концовки заглушены не отдельным флагом (его в ядре нет), а
// НЕДОСТИЖИМЫМИ порогами — тем же приёмом, что и в `econplaytest.mjs`. Победа выбыванием
// остаётся: если сторона потеряла всё, добивать сессию нечего.
const SESSION_DAYS = 14;
const CAP = (SESSION_DAYS + 3) * DAY; // harness safety net — `endsAt` срабатывает первым
const config = {
  timeScale: 1,
  victory: {
    endsAt: SESSION_DAYS * DAY,
    scoreLimit: 100_000_000, // порог очков недостижим ⇒ досрочной победы по очкам нет
    dominationPercent: 1, // только полная карта — иначе сессия обрывалась бы на 60%
  },
};
const ctx = (now) => ({ now, data, config });

function leaderByPlanets(state) {
  const counts = {};
  for (const p of Object.values(state.planets)) {
    if (p.owner) counts[p.owner] = (counts[p.owner] ?? 0) + 1;
  }
  let best = null;
  let bestN = -1;
  let tied = false;
  for (const [owner, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = owner;
      bestN = n;
      tied = false;
    } else if (n === bestN) tied = true;
  }
  return tied ? null : best;
}

function runMatch(i) {
  const swapStart = i % 2 === 1;
  // Дуэлянты садятся ДИАМЕТРАЛЬНО (сектор k и сектор k+5 из десяти), а не в соседние.
  // Противоположная пара честна по построению: у неё общий бюджет двора и одинаковый
  // профиль по прыжкам (BAL-1). Соседняя пара тоже равнозначна по метрикам, но фронт
  // упирается друг в друга с первого часа: замер давал первый бой на 1.4-й день и 28%
  // добиваний. Формат `1v1` в игре сажает игроков так же — противоположными индексами.
  //
  // BAL-9: пара ПЕРЕБИРАЕТСЯ по кругу (k = номер матча по модулю пяти). Секторы перестали
  // быть копиями друг друга — у каждого свой рисунок, свои расстояния и своя пара типов
  // планет, — поэтому замер на одной паре мерил бы один рисунок из пяти и молча пропускал
  // перекос остальных. Теперь строка «очки/старт» покрывает все десять позиций.
  const HALF = Math.floor(START_CANDIDATES.length / 2);
  const home = Math.floor(i / 4) % HALF;
  const pair = [START_CANDIDATES[home], START_CANDIDATES[home + HALF]];
  const starts = swapStart ? [pair[1], pair[0]] : [pair[0], pair[1]];
  const factions = FACTION_PAIRS[(i >> 1) % FACTION_PAIRS.length];
  const seats = [
    { id: 'p1', name: 'Bot One', faction: factions[0], start: starts[0], ai: true },
    { id: 'p2', name: 'Bot Two', faction: factions[1], start: starts[1], ai: true },
  ];
  let state = newGame({ seats, seed: `${BASE_SEED}-${i}` });

  // Юниты, которые матч РАЗДАЁТ на старте, а не строит. Без этого отчёт врал: `hero`
  // числился «мёртвым контентом» — притом что герой у каждого места стоит во флоте с
  // первой секунды (`matchSetup`: флагман домашнего флота) и исправно воюет. Он просто
  // не проходит через `unit.built`, а `usage` считает именно постройки.
  const seeded = new Set();
  for (const f of Object.values(state.fleets)) for (const st of f.units) seeded.add(st.unit);
  for (const p of Object.values(state.planets)) for (const st of p.garrison) seeded.add(st.unit);

  const usage = new Map(); // built unit/building -> count
  const techUsage = new Map(); // researched technology -> count
  let battles = 0;
  // AI-BAL-3: двухфазный захват (орбита → десант, GDD §7.4) отдельной строкой. До этой
  // правки батч показывал только «боёв всего», и наземная фаза, которой в матче не было
  // ВООБЩЕ, ничем не отличалась от наземной фазы, которая была: обе давали один и тот же
  // счётчик. Захваты разделены по способу: `via: 'arrival'` — прилетел и забрал
  // (`captureOnArrival`), без `via` — взял штурмом (`combat.capturePlanet`).
  let groundBattles = 0;
  // AI-BAL-10: способов взять мир ТРИ, и раньше отчёт знал два. Прилёт на ничей мир,
  // занятие необороняемого чужого с орбиты и выигранный наземный бой лечатся по-разному,
  // а пока два последних лежали в одной корзине, строка читалась наоборот происходящему:
  // после AI-BAL-7 «штурмы» выросли вчетверо при том, что наземных боёв стало МЕНЬШЕ.
  let capturesByArrival = 0;
  let capturesByOccupy = 0;
  let capturesByAssault = 0;
  // AI-BAL-7: тактический репертуар отдельными счётчиками. Без них правка «бот умеет
  // отступать» не проверяема: отступление РАСПУСКАЕТ бой, а не завершает его, поэтому
  // `battle.resolved` про него молчит, и в отчёте оно выглядело бы просто как убыль
  // боёв — то есть неотличимо от «бот стал меньше воевать».
  let retreats = 0;
  let sieges = 0;
  let splits = 0;
  let bombardSpans = 0;
  // Судьба проигравшего флота — прямая проверка утверждения «размен перестал быть полным».
  // Само число отступлений её не даёт: выход стоит 40% ТЕКУЩЕГО корпуса и щита, и если бы
  // пошлина добивала, отступления считались бы, а флоты гибли бы по-прежнему. Поэтому
  // отдельно: сколько флотов ушло из измерения совсем (`fleet.destroyed` — и разгром, и
  // добитый пошлиной) и сколько выходов не донесло (`escaped: false`).
  let fleetsDestroyed = 0;
  let retreatsFatal = 0;
  // AI-BAL-8: ветка героев отдельными счётчиками. Герой ПОСЕЯН в каждом матче и дерётся
  // как корпус, поэтому «мёртвым контентом» он не числился ни разу — а всё, что вокруг
  // него (ростер, дерево навыков, фитинги, диспетчер способностей), в измерении не
  // участвовало. Одна общая строка это скрывала: без счётчиков «герой играет» и «герой
  // просто стоит во флоте» выглядят одинаково.
  let heroSpawns = 0;
  let heroSkills = 0;
  let heroFits = 0;
  const heroCasts = new Map(); // тип способности → сколько раз кастовали
  let firstCombatAt = null;
  const consume = (events, now) => {
    for (const e of events) {
      if (e.type === 'unit.built') {
        const p = e.payload ?? {};
        usage.set(p.unit, (usage.get(p.unit) ?? 0) + (p.count ?? 1));
      } else if (e.type === 'building.constructed') {
        const p = e.payload ?? {};
        usage.set(p.building, (usage.get(p.building) ?? 0) + 1);
      } else if (e.type === 'technology.researched') {
        const p = e.payload ?? {};
        if (p.technology) techUsage.set(p.technology, (techUsage.get(p.technology) ?? 0) + 1);
      } else if (e.type === 'battle.resolved') {
        battles++;
        if ((e.payload ?? {}).phase === 'ground') groundBattles++;
      } else if (e.type === 'planet.captured') {
        const via = (e.payload ?? {}).via;
        if (via === 'arrival') capturesByArrival++;
        else if (via === 'occupy') capturesByOccupy++;
        else capturesByAssault++;
      } else if (e.type === 'fleet.destroyed') {
        fleetsDestroyed++;
      } else if (e.type === 'hero.spawned') {
        heroSpawns++;
      } else if (e.type === 'hero.skill.unlocked') {
        heroSkills++;
      } else if (e.type === 'hero.fitted') {
        heroFits++;
      } else if (e.type === 'hero.ability.used') {
        const t = (e.payload ?? {}).type ?? '?';
        heroCasts.set(t, (heroCasts.get(t) ?? 0) + 1);
      } else if (e.type === 'fleet.retreated') {
        retreats++;
        if ((e.payload ?? {}).escaped === false) retreatsFatal++;
      } else if (e.type === 'fleet.bombard') {
        if ((e.payload ?? {}).on === true) sieges++;
      } else if (e.type === 'fleet.split') {
        splits++;
      } else if (e.type === 'planet.bombarded') {
        bombardSpans++;
      } else if (e.type === 'battle.started' && firstCombatAt === null) firstCombatAt = now;
    }
  };

  const leaderTrail = []; // sampled (t, leader-by-planets) — the snowball input
  // BAL-5: слагаемые счёта по дням. Кирпич спрашивает, ЧТО разгоняет лидера; ответ по
  // коду («флот в счёт не входит вовсе», GDD §8.1) сужает вопрос до двух слагаемых —
  // территория против построек, — и вот их трасса по времени.
  const partsTrail = []; // [{ day, bySeat: { p1: {territory, buildings, total}, … } }]
  let nextSampleDay = 1;
  let now = 0;
  // Seat-order coin, seeded per match (first-mover fairness WITH variance): a fixed
  // order handed p1 75% of matches, and a strict alternation is still one global
  // script — every seed replayed the same game, so "win rates" were binary. A
  // seed-hashed coin per step keeps runs reproducible while different seeds explore
  // different order interleavings — rates become rates.
  let coin = 0;
  for (const ch of `${BASE_SEED}-${i}`) coin = (coin * 31 + ch.charCodeAt(0)) >>> 0;
  const reversedAt = (step) => (((coin ^ Math.imul(step, 2654435761)) >>> 16) & 1) === 1;
  let stepIdx = 0;
  while (now < CAP && state.match.status !== 'ended') {
    now += STEP;
    // catch the world up (chunked — a partial advance keeps making progress)
    for (let c = 0; c < 10; c++) {
      const r = kernel.advanceTo(state, ctx(now));
      if (!r.ok) return { error: r.code };
      state = r.state;
      consume(r.events, now);
      if (!r.partial) break;
      if (r.state.time <= state.time && c > 0) break; // same-instant runaway — bail
    }
    if (state.match.status === 'ended') break;
    // Each seat's AI issues its orders through the same pure reducer; the iteration
    // order per step comes from the seeded coin (see above).
    const seatsInOrder = Object.keys(state.players);
    if (reversedAt(stepIdx)) seatsInOrder.reverse();
    stepIdx += 1;
    for (const seat of seatsInOrder) {
      // 'test' — лабораторный профиль (AI-BAL-1.1). Живой игрок такого бота не встречает:
      // соло и прото-хост зовут aiOrders без профиля, и выставить его в игре нечем.
      for (const a of aiOrders(state, seat, 'expand', 'test')) {
        const r = kernel.applyAction(state, a, ctx(now));
        if (r.ok) {
          state = r.state;
          consume(r.events, now);
        }
      }
    }
    leaderTrail.push({ t: now, leader: leaderByPlanets(state) });
    // Снимок раз в игровой день (14 точек на матч) — этого хватает на трассу разрыва
    // и не раздувает прогон.
    while (state.time >= nextSampleDay * DAY) {
      const parts = scoreParts(state, data);
      // Сколько провинций ещё НИЧЬИ. Плато счёта во второй половине объясняется либо
      // «карта поделена, брать больше нечего», либо «экономика насытилась» — это разные
      // диагнозы и разные лечения, поэтому механизм меряется, а не додумывается.
      let neutral = 0;
      for (const p2 of Object.values(state.planets)) if (p2.owner === null) neutral += 1;
      partsTrail.push({
        day: nextSampleDay,
        neutral,
        bySeat: Object.fromEntries(
          Object.entries(parts).map(([seat, p]) => [
            seat,
            { territory: p.territory, buildings: p.buildings, total: p.total },
          ]),
        ),
      });
      nextSampleDay += 1;
    }
  }

  const winner = state.match.status === 'ended' ? (state.match.winner ?? null) : null;
  // snowball input: who led (by planets) at the halfway point of THIS match
  const half = state.time / 2;
  let midLeader = null;
  for (const s of leaderTrail) {
    if (s.t <= half) midLeader = s.leader;
    else break;
  }
  const seatMeta = Object.fromEntries(seats.map((s) => [s.id, s]));
  // Итоговый счёт каждого места. `victoryModule` пересчитывает его при каждой оценке и
  // кладёт в состояние (`match.scores`), поэтому на финале там уже финальные числа —
  // харнесу не нужна своя копия формулы (и она не разъедется с ядром).
  const finalScores = Object.fromEntries(
    Object.entries(state.match.scores ?? {}).map(([seat, sc]) => [seat, sc?.total ?? 0]),
  );
  return {
    finalScores,
    finalParts: scoreParts(state, data),
    partsTrail,
    seatMeta,
    winner,
    winnerFaction: winner ? seatMeta[winner]?.faction : null,
    winnerStart: winner ? seatMeta[winner]?.start : null,
    lengthMs: state.time,
    reason: state.match.reason,
    battles,
    groundBattles,
    retreats,
    retreatsFatal,
    fleetsDestroyed,
    sieges,
    splits,
    bombardSpans,
    heroSpawns,
    heroSkills,
    heroFits,
    heroCasts,
    capturesByArrival,
    capturesByOccupy,
    capturesByAssault,
    firstCombatAt,
    midLeader,
    usage,
    techUsage,
    seeded,
  };
}

// --- run the batch ---------------------------------------------------------------
const t0 = Date.now();
const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const winsBySlot = new Map();
const winsByFaction = new Map();
const winsByStart = new Map();
const reasons = new Map();
const usageTotal = new Map();
const seededTotal = new Set();
const techTotal = new Map();
const lengths = [];
const firstCombats = [];
let draws = 0;
let errors = 0;
let decided = 0;
let snowballHits = 0;
let battlesTotal = 0;
// РЕЙТИНГ ПО ОЧКАМ (заказ владельца): бинарное «кто выиграл» ничего не говорит о том,
// НАСКОЛЬКО. Средний счёт по слоту/фракции/старту отвечает на вопрос прямо: какие условия
// приводят тест-бота к большему счёту за одинаковую неделю.
const scoreBySlot = new Map();
const scoreByFaction = new Map();
const scoreByStart = new Map();
const seenBySlot = new Map();
const seenByFaction = new Map();
// Появления в РЕШЁННЫХ матчах — знаменатель доли побед. `seenByFaction` считает и ничьи,
// а делить победы на матчи, где победителя не было, значит занижать долю у всех сразу.
const decidedByFaction = new Map();
const seenByStart = new Map();
const winnerScores = [];
const loserScores = [];
const margins = [];
let groundBattlesTotal = 0;
let retreatsTotal = 0;
let retreatsFatalTotal = 0;
let fleetsDestroyedTotal = 0;
let siegesTotal = 0;
let splitsTotal = 0;
let bombardSpansTotal = 0;
let heroSpawnsTotal = 0;
let heroSkillsTotal = 0;
let heroFitsTotal = 0;
const heroCastsTotal = new Map();
let arrivalCaptures = 0;
let occupyCaptures = 0;
let assaultCaptures = 0;
// BAL-5 — ЧТО разгоняет лидера. Флот отпадает по коду (в `total` он не входит вовсе),
// поэтому меряются два слагаемых и ДИНАМИКА разрыва: разрыв, поставленный рано и просто
// удержанный, — это фора позиции, а разрыв, растущий во второй половине, — снежный ком.
const marginTerritory = []; // (победитель − проигравший) по территории, на финале
const marginBuildings = []; // то же по постройкам
const gapByDay = new Map(); // день → сумма разрывов по total (для среднего)
const gapTerritoryByDay = new Map();
const gapBuildingsByDay = new Map();
const gapSeenByDay = new Map();
const winnerScoreByDay = new Map(); // абсолютная кривая — без неё «разрыв растёт» двусмысленно
const loserScoreByDay = new Map();
const neutralByDay = new Map(); // ничьи провинции по дням — механизм плато
const growthFirstHalf = []; // прирост счёта победителя за 1..7 день
const growthSecondHalf = []; // …и за 8..14
const loserGrowthFirstHalf = [];
const loserGrowthSecondHalf = [];
let leadHeldFromDay = []; // с какого дня будущий победитель уже вёл и больше не отдавал

for (let i = 0; i < N; i++) {
  const r = runMatch(i);
  if (r.error) {
    errors++;
    continue;
  }
  battlesTotal += r.battles;
  groundBattlesTotal += r.groundBattles;
  retreatsTotal += r.retreats;
  retreatsFatalTotal += r.retreatsFatal;
  fleetsDestroyedTotal += r.fleetsDestroyed;
  siegesTotal += r.sieges;
  splitsTotal += r.splits;
  bombardSpansTotal += r.bombardSpans;
  heroSpawnsTotal += r.heroSpawns;
  heroSkillsTotal += r.heroSkills;
  heroFitsTotal += r.heroFits;
  for (const [t, n] of r.heroCasts) heroCastsTotal.set(t, (heroCastsTotal.get(t) ?? 0) + n);
  arrivalCaptures += r.capturesByArrival;
  occupyCaptures += r.capturesByOccupy;
  assaultCaptures += r.capturesByAssault;
  lengths.push(r.lengthMs);
  if (r.firstCombatAt !== null) firstCombats.push(r.firstCombatAt);
  if (r.winner === null) draws++;
  else {
    bump(winsBySlot, r.winner);
    bump(winsByFaction, r.winnerFaction ?? '?');
    bump(winsByStart, r.winnerStart ?? '?');
    bump(reasons, r.reason ?? '?');
    decided++;
    if (r.midLeader !== null && r.midLeader === r.winner) snowballHits++;
  }
  for (const [seat, total] of Object.entries(r.finalScores)) {
    const meta = r.seatMeta[seat];
    bump(scoreBySlot, seat, total);
    bump(seenBySlot, seat);
    if (meta) {
      bump(scoreByFaction, meta.faction, total);
      bump(seenByFaction, meta.faction);
      if (r.winner !== null) bump(decidedByFaction, meta.faction);
      bump(scoreByStart, meta.start, total);
      bump(seenByStart, meta.start);
    }
  }
  {
    const totals = Object.entries(r.finalScores).sort((a, b) => b[1] - a[1]);
    if (totals.length >= 2) {
      winnerScores.push(totals[0][1]);
      loserScores.push(totals[totals.length - 1][1]);
      margins.push(totals[0][1] - totals[totals.length - 1][1]);
    }
  }
  // BAL-5: разложение исхода. Считаем только решённые матчи — «кто разогнался» без
  // победителя не определено.
  if (r.winner !== null && r.partsTrail.length > 0) {
    const seats = Object.keys(r.finalParts);
    const loser = seats.find((s2) => s2 !== r.winner);
    if (loser) {
      const w = r.finalParts[r.winner];
      const l = r.finalParts[loser];
      marginTerritory.push(w.territory - l.territory);
      marginBuildings.push(w.buildings - l.buildings);
      const at = (day, seat, field) => {
        const s2 = r.partsTrail.find((x) => x.day === day);
        return s2?.bySeat?.[seat]?.[field] ?? 0;
      };
      const lastDay = r.partsTrail[r.partsTrail.length - 1].day;
      const mid = Math.floor(lastDay / 2);
      growthFirstHalf.push(at(mid, r.winner, 'total') - at(1, r.winner, 'total'));
      growthSecondHalf.push(at(lastDay, r.winner, 'total') - at(mid, r.winner, 'total'));
      loserGrowthFirstHalf.push(at(mid, loser, 'total') - at(1, loser, 'total'));
      loserGrowthSecondHalf.push(at(lastDay, loser, 'total') - at(mid, loser, 'total'));
      // С какого дня победитель ведёт и больше не отдаёт лидерство — «рано и навсегда»
      // против «перехватил в конце».
      let held = null;
      for (let d = lastDay; d >= 1; d--) {
        if (at(d, r.winner, 'total') > at(d, loser, 'total')) held = d;
        else break;
      }
      if (held !== null) leadHeldFromDay.push(held);
      for (const sample of r.partsTrail) {
        const wd = sample.bySeat[r.winner] ?? { territory: 0, buildings: 0, total: 0 };
        const ld = sample.bySeat[loser] ?? { territory: 0, buildings: 0, total: 0 };
        bump(gapByDay, sample.day, wd.total - ld.total);
        bump(gapTerritoryByDay, sample.day, wd.territory - ld.territory);
        bump(gapBuildingsByDay, sample.day, wd.buildings - ld.buildings);
        bump(winnerScoreByDay, sample.day, wd.total);
        bump(loserScoreByDay, sample.day, ld.total);
        bump(neutralByDay, sample.day, sample.neutral ?? 0);
        bump(gapSeenByDay, sample.day);
      }
    }
  }
  for (const k of r.seeded) seededTotal.add(k);
  for (const [k, v] of r.usage) bump(usageTotal, k, v);
  for (const [k, v] of r.techUsage) bump(techTotal, k, v);
  if ((i + 1) % 10 === 0) process.stderr.write(`  … ${i + 1}/${N}\r`);
}

const days = (ms) => (ms / DAY).toFixed(1);
/** Доли двух слагаемых отрыва в процентах — «территория 71% / постройки 29%». */
const pctShare = (a, b) => {
  const sum = a + b;
  if (sum === 0) return '—';
  return `территория ${Math.round((a / sum) * 100)}% / постройки ${Math.round((b / sum) * 100)}%`;
};
/** Абсолютные кривые счёта по дням — «разрыв растёт» без них двусмысленно: это может
 *  быть и разгон лидера, и падение отстающего. */
const scoreLine = () => {
  const ds = [...gapSeenByDay.keys()].sort((a, b) => a - b);
  if (ds.length === 0) return '—';
  const picked = ds.filter((d) => d === 1 || d === ds[ds.length - 1] || d % 3 === 0);
  return picked
    .map((d) => {
      const n = gapSeenByDay.get(d) || 1;
      return `д${d} ${(winnerScoreByDay.get(d) / n).toFixed(0)}/${(loserScoreByDay.get(d) / n).toFixed(0)}`;
    })
    .join(' · ');
};
/** Сколько провинций ещё ничьи, по дням: день, когда это доходит до нуля, и есть конец
 *  раздела карты — дальше счёт не создаётся, а перетекает. */
const neutralLine = () => {
  const ds = [...gapSeenByDay.keys()].sort((a, b) => a - b);
  if (ds.length === 0) return '—';
  const picked = ds.filter((d) => d === 1 || d === ds[ds.length - 1] || d % 2 === 0);
  return picked
    .map((d) => `д${d} ${(neutralByDay.get(d) / (gapSeenByDay.get(d) || 1)).toFixed(0)}`)
    .join(' · ');
};
/** Разрыв по дням одной строкой: «д1 12 · д4 58 · д7 96 · д10 128 · д14 171». */
const gapLine = () => {
  const days = [...gapSeenByDay.keys()].sort((a, b) => a - b);
  if (days.length === 0) return '—';
  const picked = days.filter((d) => d === 1 || d === days[days.length - 1] || d % 3 === 0);
  return picked
    .map((d) => `д${d} ${(gapByDay.get(d) / (gapSeenByDay.get(d) || 1)).toFixed(0)}`)
    .join(' · ');
};
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(0)}%`);
const fmtWins = (m) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v} (${pct(v, decided)})`)
    .join(' · ') || '—';
/** «ключ победы/партии (доля)» — для ключей, которые участвуют НЕ в каждом матче.
 *  С двумя фракциями доля от общего числа матчей была той же величиной; с четырьмя дом
 *  садится примерно в половину партий, и деление на `decided` занизило бы всех вдвое. */
const fmtRate = (wins, played) =>
  [...played.entries()]
    .map(([k, n]) => [k, wins.get(k) ?? 0, n])
    .sort((a, b) => b[1] / b[2] - a[1] / a[2])
    .map(([k, w, n]) => `${k} ${w}/${n} (${pct(w, n)})`)
    .join(' · ') || '—';
/** «ключ среднее» по убыванию — рейтинг, а не сырые суммы: матчей у ключей разное число. */
const fmtAvg = (sums, seen) =>
  [...sums.entries()]
    .map(([k, v]) => [k, v / (seen.get(k) || 1)])
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v.toFixed(0)}`)
    .join(' · ') || '—';
const topUsage = [...usageTotal.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([k, v]) => `${k}=${v}`)
  .join(' ');
// «Мёртвый контент» — то, что не построено НИ РАЗУ и при этом не раздаётся на старте:
// посеянный юнит без построек не мёртв, он просто не строится (герой), и мешать эти два
// случая — значит гнать балансную правку туда, где всё работает.
const neverBuilt = Object.keys({ ...data.units, ...data.buildings }).filter(
  (k) => !usageTotal.has(k),
);
const zeros = neverBuilt.filter((k) => !seededTotal.has(k));
const seededOnly = neverBuilt.filter((k) => seededTotal.has(k));
const topTech = [...techTotal.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([k, v]) => `${k}=${v}`)
  .join(' ');
const techZeros = Object.keys(data.technologies ?? {}).filter((k) => !techTotal.has(k));
const techTotalCount = [...techTotal.values()].reduce((s, v) => s + v, 0);

console.log(
  [
    `━━ self-play balance ━━ ${N} матчей · seed "${BASE_SEED}-*" · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    `  decided   : ${decided} · draws ${draws} (кап ${days(CAP)}д)${errors ? ` · ERRORS ${errors}` : ''}`,
    `  win by slot    : ${fmtWins(winsBySlot)}   ← цель ~50/50`,
    `  win by faction : ${fmtRate(winsByFaction, decidedByFaction)}   ← побед/партий; дом садится примерно в половину матчей (AI-BAL-12)`,
    `  win by start   : ${fmtWins(winsByStart)}`,
    `  длина      : avg ${days(avg(lengths))}д · min ${days(Math.min(...lengths))}д · max ${days(Math.max(...lengths))}д · исходы: ${fmtWins(reasons)}`,
    `  1-й бой    : avg ${days(avg(firstCombats))}д (в ${firstCombats.length}/${N} матчах) · боёв всего ${battlesTotal}`,
    `  наземная   : ${groundBattlesTotal} наземных боёв из ${battlesTotal} · захваты: прилётом ${arrivalCaptures} · занято с орбиты ${occupyCaptures} · штурмом ${assaultCaptures}  ← «штурмом» и есть вторая фаза захвата (GDD §7.4); 0 = она не играется. «Занято с орбиты» боя НЕ требует — это чужой мир без гарнизона (AI-BAL-10)`,
    `  тактика    : отступлений ${retreatsTotal} · осад ${siegesTotal} (обстрелов ${bombardSpansTotal}) · расколов флота ${splitsTotal}  ← AI-BAL-7; 0 в строке = механика вне измерения`,
    `  герои      : подъёмов ${heroSpawnsTotal} · узлов дерева ${heroSkillsTotal} · фитингов ${heroFitsTotal} · кастов ${
      [...heroCastsTotal.entries()].sort().map(([t, n]) => `${t}=${n}`).join(' ') || '0'
    }  ← AI-BAL-8; каст СЧИТАЕТСЯ ПО ТИПУ, потому что правило бота тоже по типу, а не по id`,
    `  размен     : флотов погибло ${fleetsDestroyedTotal} · из отступлений не донесло ${retreatsFatalTotal}  ← полный размен = флот гибнет всегда; отступления без падения этого числа ничего не меняют`,
    `  очки       : лидер ${avg(winnerScores).toFixed(0)} · отставший ${avg(loserScores).toFixed(0)} · разрыв ${avg(margins).toFixed(0)}  ← сессия одинаковая (${SESSION_DAYS}д), разный только счёт`,
    `  очки/слот    : ${fmtAvg(scoreBySlot, seenBySlot)}`,
    `  очки/фракция : ${fmtAvg(scoreByFaction, seenByFaction)}`,
    `  очки/старт   : ${fmtAvg(scoreByStart, seenByStart)}`,
    `  snowball   : ${pct(snowballHits, decided)} лидеров середины выиграли  ← высокий % = снежный ком, камбэков нет`,
    // BAL-5: из ЧЕГО сложился отрыв и КОГДА он сложился. Флот в счёт не входит вовсе
    // (GDD §8.1), поэтому слагаемых два — территория и постройки.
    `  отрыв      : территория ${avg(marginTerritory).toFixed(0)} + постройки ${avg(marginBuildings).toFixed(0)}` +
      ` = ${(avg(marginTerritory) + avg(marginBuildings)).toFixed(0)}` +
      `  (${pctShare(avg(marginTerritory), avg(marginBuildings))})  ← чем именно победитель обошёл`,
    `  разрыв/день: ${gapLine()}  ← растёт во второй половине = ком; ровный = фора позиции`,
    `  счёт/день  : ${scoreLine()}  ← победитель/проигравший; расходится вверх = разгон, вниз = обвал отстающего`,
    `  ничьих/день: ${neutralLine()}  ← когда кончается свободная карта: после этого счёт может только ПЕРЕТЕКАТЬ`,
    `  прирост    : победитель ${avg(growthFirstHalf).toFixed(0)}→${avg(growthSecondHalf).toFixed(0)}` +
      ` · проигравший ${avg(loserGrowthFirstHalf).toFixed(0)}→${avg(loserGrowthSecondHalf).toFixed(0)}` +
      `  ← 1-я половина → 2-я, очков за половину`,
    `  лидерство  : с ${avg(leadHeldFromDay).toFixed(1)}-го дня победитель ведёт и не отдаёт (из ${(avg(lengths) / DAY).toFixed(0)})`,
    `  usage      : ${topUsage || '—'}`,
    zeros.length ? `  мёртвый контент (0 построек за ${N} матчей): ${zeros.join(' ')}` : '  мёртвый контент: нет ✓',
    seededOnly.length ? `  посеяны, не строятся (в мёртвый контент НЕ входят): ${seededOnly.join(' ')}` : null,
    `  техи       : ${techTotalCount} исследовано · ${topTech || '—'}`,
    techZeros.length
      ? `  не исследованы ни разу (${techZeros.length}/${Object.keys(data.technologies ?? {}).length}): ${techZeros.join(' ')}`
      : '  дерево технологий пройдено целиком ✓',
    '━'.repeat(70),
    // AUD-7: всё, что печатается человеку выше, отдаётся и машине. Раньше половина
    // показателей — разброс длины, раскладка исходов, первый бой, usage, мёртвый контент —
    // умирала на границе `console.log`, и скиллу `balance-analysis` приходилось парсить
    // прозу. Имена существующих полей НЕ трогаем: их уже читают снаружи.
    'SELFPLAY_JSON ' +
      JSON.stringify({
        n: N,
        decided,
        draws,
        errors,
        winsBySlot: Object.fromEntries(winsBySlot),
        winsByFaction: Object.fromEntries(winsByFaction),
        playedByFaction: Object.fromEntries(decidedByFaction),
        winsByStart: Object.fromEntries(winsByStart),
        avgLengthDays: avg(lengths) / DAY,
        techResearched: techTotalCount,
        techUsage: Object.fromEntries(techTotal),
        deadTech: techZeros,
        snowball: decided ? snowballHits / decided : null,
        // BAL-5: разложение отрыва и его динамика.
        marginTerritory: avg(marginTerritory),
        marginBuildings: avg(marginBuildings),
        gapByDay: Object.fromEntries(
          [...gapSeenByDay.keys()]
            .sort((a, b) => a - b)
            .map((d) => [
              d,
              {
                total: gapByDay.get(d) / gapSeenByDay.get(d),
                territory: gapTerritoryByDay.get(d) / gapSeenByDay.get(d),
                buildings: gapBuildingsByDay.get(d) / gapSeenByDay.get(d),
              },
            ]),
        ),
        scoreByDay: Object.fromEntries(
          [...gapSeenByDay.keys()]
            .sort((a, b) => a - b)
            .map((d) => [
              d,
              {
                winner: winnerScoreByDay.get(d) / gapSeenByDay.get(d),
                loser: loserScoreByDay.get(d) / gapSeenByDay.get(d),
              },
            ]),
        ),
        neutralByDay: Object.fromEntries(
          [...gapSeenByDay.keys()]
            .sort((a, b) => a - b)
            .map((d) => [d, neutralByDay.get(d) / gapSeenByDay.get(d)]),
        ),
        winnerGrowth: { firstHalf: avg(growthFirstHalf), secondHalf: avg(growthSecondHalf) },
        loserGrowth: {
          firstHalf: avg(loserGrowthFirstHalf),
          secondHalf: avg(loserGrowthSecondHalf),
        },
        leadHeldFromDay: avg(leadHeldFromDay),
        lengthMinDays: lengths.length ? Math.min(...lengths) / DAY : null,
        lengthMaxDays: lengths.length ? Math.max(...lengths) / DAY : null,
        outcomes: Object.fromEntries(reasons),
        firstCombatAvgDays: firstCombats.length ? avg(firstCombats) / DAY : null,
        firstCombatMatches: firstCombats.length,
        sessionDays: SESSION_DAYS,
        avgWinnerScore: avg(winnerScores),
        avgLoserScore: avg(loserScores),
        avgMargin: avg(margins),
        avgScoreBySlot: Object.fromEntries(
          [...scoreBySlot].map(([k, v]) => [k, v / (seenBySlot.get(k) || 1)]),
        ),
        avgScoreByFaction: Object.fromEntries(
          [...scoreByFaction].map(([k, v]) => [k, v / (seenByFaction.get(k) || 1)]),
        ),
        avgScoreByStart: Object.fromEntries(
          [...scoreByStart].map(([k, v]) => [k, v / (seenByStart.get(k) || 1)]),
        ),
        battlesTotal,
        groundBattlesTotal,
        capturesByArrival: arrivalCaptures,
        capturesByOccupy: occupyCaptures,
        capturesByAssault: assaultCaptures,
        heroSpawns: heroSpawnsTotal,
        heroSkills: heroSkillsTotal,
        heroFits: heroFitsTotal,
        heroCasts: Object.fromEntries(heroCastsTotal),
        retreats: retreatsTotal,
        retreatsFatalTotal,
        fleetsDestroyedTotal,
        sieges: siegesTotal,
        bombardSpans: bombardSpansTotal,
        splits: splitsTotal,
        usage: Object.fromEntries(usageTotal),
        deadContent: zeros,
        seededOnly,
      }),
  ]
    .filter((line) => line !== null)
    .join('\n'),
);
