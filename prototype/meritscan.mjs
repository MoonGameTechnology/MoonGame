// ЗАМЕР ЗАСЛУГИ ВЕТЕРАНА (VET-3) — сколько урона и боёв реально набегает на стек за матч.
//
//   pnpm run meritscan              # 8 матчей, сид "merit", 14 игровых дней
//   pnpm run meritscan 6 merit 60   # 6 матчей, тот же сид, 60-дневная сессия
//
// ЗАЧЕМ ОН ЖИВЁТ В РЕПОЗИТОРИИ, а не остался черновиком. Пороги степеней медали
// (`data/medalGrades.json`) — это ЧИСЛА ИЗ ИГРЫ, снятые вот этим прибором, и записаны они
// в `docs/unit-medals-roadmap.md` §0.5 таблицей. Как только изменится баланс боя, юнитов
// или длина сессии, таблица устареет — и без прибора её нельзя будет пересверить, только
// переугадать. Тот же довод, по которому в репозитории лежат `selfplay.mjs` и
// `econplaytest.mjs`: замер, который нельзя повторить, через месяц становится легендой.
//
// Повторяет цикл `prototype/selfplay.mjs` минимально: реальное ядро, боты 'strong',
// доктрина 'expand', два места, недостижимые пороги досрочной победы. Балансную таблицу не
// считает вовсе — только заслугу всех стеков, доживших до конца матча (флоты, десант,
// гарнизоны, плацдармы).
import { build } from 'esbuild';

const N = Math.max(1, Number(process.argv[2] ?? 8) || 8);
const BASE_SEED = process.argv[3] ?? 'merit';
const SESSION_DAYS = Math.max(1, Number(process.argv[4] ?? 14) || 14);

const res = await build({
  entryPoints: ['prototype/src/game.ts'],
  bundle: true, platform: 'node', format: 'cjs', target: 'es2020', write: false,
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', res.outputFiles[0].text)(mod, mod.exports, () => ({}));
const { newGame, kernel, data, aiOrders, PLAYABLE_FACTIONS, HOUR, DAY, START_CANDIDATES } = mod.exports;

const STEP = 2 * HOUR;
const CAP = (SESSION_DAYS + 3) * DAY;
const config = {
  timeScale: 1,
  victory: { endsAt: SESSION_DAYS * DAY, scoreLimit: 100_000_000, dominationPercent: 1 },
};
const ctx = (now) => ({ now, data, config });
const FACTION_IDS = [...PLAYABLE_FACTIONS];
const FACTION_PAIRS = FACTION_IDS.flatMap((a) => FACTION_IDS.filter((b) => b !== a).map((b) => [a, b]));

/** Все стеки, живущие в состоянии: флоты, десант, гарнизоны, плацдармы. */
function* everyStack(state) {
  for (const f of Object.values(state.fleets)) {
    for (const st of f.units) yield st;
    for (const st of f.landing ?? []) yield st;
  }
  for (const p of Object.values(state.planets)) {
    for (const st of p.garrison) yield st;
    for (const b of p.beachheads ?? []) for (const st of b.units) yield st;
  }
}

const damage = [];
const battles = [];
let stacksTotal = 0;
let stacksDecorated = 0;

for (let i = 0; i < N; i++) {
  const HALF = Math.floor(START_CANDIDATES.length / 2);
  const home = Math.floor(i / 4) % HALF;
  const pair = [START_CANDIDATES[home], START_CANDIDATES[home + HALF]];
  const starts = i % 2 ? [pair[1], pair[0]] : [pair[0], pair[1]];
  const factions = FACTION_PAIRS[(i >> 1) % FACTION_PAIRS.length];
  let state = newGame({ seats: [
    { id: 'p1', name: 'Bot One', faction: factions[0], start: starts[0], ai: true },
    { id: 'p2', name: 'Bot Two', faction: factions[1], start: starts[1], ai: true },
  ], seed: `${BASE_SEED}-${i}` });

  let now = 0;
  while (now < CAP && state.match.status !== 'ended') {
    now += STEP;
    for (let c = 0; c < 10; c++) {
      const r = kernel.advanceTo(state, ctx(now));
      if (!r.ok) { console.error('advance failed', r.code); break; }
      const prev = state; state = r.state;
      if (!r.partial) break;
      if (r.state.time <= prev.time && c > 0) break;
    }
    if (state.match.status === 'ended') break;
    for (const seat of Object.keys(state.players)) {
      for (const a of aiOrders(state, seat, 'expand', 'strong')) {
        const r = kernel.applyAction(state, a, ctx(now));
        if (r.ok) state = r.state;
      }
    }
  }
  for (const st of everyStack(state)) {
    stacksTotal += 1;
    if (st.damageDealt !== undefined || st.battles !== undefined) stacksDecorated += 1;
    if (st.damageDealt) damage.push(st.damageDealt);
    if (st.battles) battles.push(st.battles);
  }
  process.stderr.write(`матч ${i + 1}/${N}\r`);
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n) => (Math.round(n * 100) / 100).toString();

console.log(`\n=== ЗАМЕР ЗАСЛУГИ: ${N} матчей, ${SESSION_DAYS} игровых дней, сид "${BASE_SEED}" ===`);
console.log(`стеков на конец матча: ${stacksTotal}, из них с заслугой: ${stacksDecorated} (${fmt((stacksDecorated / Math.max(1, stacksTotal)) * 100)}%)`);
console.log(`\nУРОН НА ЮНИТ (${damage.length} стеков со стрельбой)`);
for (const p of [50, 70, 80, 90, 95, 99]) console.log(`  p${p}: ${fmt(pct(damage, p))}`);
console.log(`  max: ${fmt(Math.max(0, ...damage))}`);
console.log(`\nБОЁВ НА ЮНИТ (${battles.length} стеков, переживших хоть бой)`);
for (const p of [50, 70, 80, 90, 95, 99]) console.log(`  p${p}: ${fmt(pct(battles, p))}`);
console.log(`  max: ${fmt(Math.max(0, ...battles))}`);
