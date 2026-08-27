// M4 self-play balance harness (docs/metrics-roadmap.md): AI vs AI on the REAL
// kernel, headless, seeded, deterministic — N matches → a balance table in one
// command. Mirrors the netserver driver loop (advance the clock, let each seat's
// AI issue orders every ~2 game-hours) with no server/network/DOM at all.
//
//   pnpm run selfplay            # 20 matches, base seed "sp"
//   pnpm run selfplay 200        # 200 matches
//   pnpm run selfplay 200 tag7   # 200 matches, another seed family
//
// Fairness controls per match index i: starts swap on i%2, factions swap on
// (i>>1)%2 — so "win rate by slot", "by faction" and "by start" separate cleanly.
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
const { newGame, kernel, data, aiOrders, HOUR, DAY, START_CANDIDATES } = mod.exports;

const STEP = 2 * HOUR; // the AI decision cadence (mirrors the netserver driver)

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
  const swapFaction = (i >> 1) % 2 === 1;
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
  const factions = swapFaction ? ['crimson', 'azure'] : ['azure', 'crimson'];
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
  let capturesByArrival = 0;
  let capturesByAssault = 0;
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
        if ((e.payload ?? {}).via === 'arrival') capturesByArrival++;
        else capturesByAssault++;
      } else if (e.type === 'battle.started' && firstCombatAt === null) firstCombatAt = now;
    }
  };

  const leaderTrail = []; // sampled (t, leader-by-planets) — the snowball input
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
    seatMeta,
    winner,
    winnerFaction: winner ? seatMeta[winner]?.faction : null,
    winnerStart: winner ? seatMeta[winner]?.start : null,
    lengthMs: state.time,
    reason: state.match.reason,
    battles,
    groundBattles,
    capturesByArrival,
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
const seenByStart = new Map();
const winnerScores = [];
const loserScores = [];
const margins = [];
let groundBattlesTotal = 0;
let arrivalCaptures = 0;
let assaultCaptures = 0;

for (let i = 0; i < N; i++) {
  const r = runMatch(i);
  if (r.error) {
    errors++;
    continue;
  }
  battlesTotal += r.battles;
  groundBattlesTotal += r.groundBattles;
  arrivalCaptures += r.capturesByArrival;
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
  for (const k of r.seeded) seededTotal.add(k);
  for (const [k, v] of r.usage) bump(usageTotal, k, v);
  for (const [k, v] of r.techUsage) bump(techTotal, k, v);
  if ((i + 1) % 10 === 0) process.stderr.write(`  … ${i + 1}/${N}\r`);
}

const days = (ms) => (ms / DAY).toFixed(1);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(0)}%`);
const fmtWins = (m) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v} (${pct(v, decided)})`)
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
    `  win by faction : ${fmtWins(winsByFaction)}`,
    `  win by start   : ${fmtWins(winsByStart)}`,
    `  длина      : avg ${days(avg(lengths))}д · min ${days(Math.min(...lengths))}д · max ${days(Math.max(...lengths))}д · исходы: ${fmtWins(reasons)}`,
    `  1-й бой    : avg ${days(avg(firstCombats))}д (в ${firstCombats.length}/${N} матчах) · боёв всего ${battlesTotal}`,
    `  наземная   : ${groundBattlesTotal} наземных боёв из ${battlesTotal} · захваты: прилётом ${arrivalCaptures} · штурмом ${assaultCaptures}  ← «штурмом» и есть вторая фаза захвата (GDD §7.4); 0 = она не играется`,
    `  очки       : лидер ${avg(winnerScores).toFixed(0)} · отставший ${avg(loserScores).toFixed(0)} · разрыв ${avg(margins).toFixed(0)}  ← сессия одинаковая (${SESSION_DAYS}д), разный только счёт`,
    `  очки/слот    : ${fmtAvg(scoreBySlot, seenBySlot)}`,
    `  очки/фракция : ${fmtAvg(scoreByFaction, seenByFaction)}`,
    `  очки/старт   : ${fmtAvg(scoreByStart, seenByStart)}`,
    `  snowball   : ${pct(snowballHits, decided)} лидеров середины выиграли  ← высокий % = снежный ком, камбэков нет`,
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
        winsByStart: Object.fromEntries(winsByStart),
        avgLengthDays: avg(lengths) / DAY,
        techResearched: techTotalCount,
        techUsage: Object.fromEntries(techTotal),
        deadTech: techZeros,
        snowball: decided ? snowballHits / decided : null,
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
        capturesByAssault: assaultCaptures,
        usage: Object.fromEntries(usageTotal),
        deadContent: zeros,
        seededOnly,
      }),
  ]
    .filter((line) => line !== null)
    .join('\n'),
);
