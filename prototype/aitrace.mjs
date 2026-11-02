// ТРАССА ПРИКАЗОВ БОТА (SLIM-3) — сторож рефакторинга `src/ai.ts` и `src/aiTurn/`. Гоняет
// партии ботов на фиксированных сидах и снимает отпечаток каждого вызова `aiOrders`. Бот
// детерминирован, поэтому правка, которая не меняет его решений, даёт те же отпечатки.
//
//   node prototype/aitrace.mjs before.json              # снять трассу (~3 мин)
//   node prototype/aitrace.mjs after.json before.json   # снять и сравнить; расхождение — код 1
//
// Партии: «Нексус» 1×1 (сильный против слабого, «Оборона» и «Активная оборона» Хранителя),
// `duel-1` и `ffa-4`, `frontier-50` с пиратами и нейтралами и все главы «Сектора Ноль» под
// правилами забега. Отпечаток шага не включает id приказов: их выдаёт один сквозной счётчик,
// и лишний приказ в ранней партии сдвинул бы все следующие. Общий отпечаток партии их
// включает.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [OUT, BEFORE] = process.argv.slice(2);
if (!OUT) {
  console.error('usage: node prototype/aitrace.mjs <out.json> [before.json]');
  process.exit(2);
}

const res = await build({
  stdin: {
    contents:
      "export * from './prototype/src/game.ts';\n" +
      "export { pveState, pveModeId, PVE_MISSION_COUNT } from './packages/client/src/gameData.ts';\n",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  write: false,
  logLevel: 'error',
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', res.outputFiles[0].text)(mod, mod.exports, () => ({}));
const {
  newGame,
  kernel,
  data,
  aiOrders,
  HOUR,
  DAY,
  START_CANDIDATES,
  networkSeats,
  pveState,
  pveModeId,
  PVE_MISSION_COUNT,
  setMatchMode,
  setMatchTravelSpeed,
  setMatchVeteranPower,
  ctx: gameCtx,
} = mod.exports;

const STEP = 2 * HOUR; // каденция бота — та же, что у сервера, соло-драйвера и selfplay
const HOUSES = ['azure', 'crimson', 'amber', 'violet'];
const HALF = Math.floor(START_CANDIDATES.length / 2);
const victory = (days) => ({
  timeScale: 1,
  victory: { endsAt: days * DAY, scoreLimit: 100_000_000, dominationPercent: 1 },
});
const nexusDuel = (i, f1, f2) => ({
  seed: `slim3-${i}`,
  seats: [
    { id: 'p1', name: 'Bot One', faction: f1, start: START_CANDIDATES[i % HALF], ai: true },
    {
      id: 'p2',
      name: 'Bot Two',
      faction: f2,
      start: START_CANDIDATES[(i % HALF) + HALF],
      ai: true,
    },
  ],
});
const onMap = (i, mapId) => {
  const plan = networkSeats('ffa', mapId);
  return {
    seed: `slim3-${mapId}-${i}`,
    mapId,
    seats: plan.map((s, k) => ({
      ...s,
      name: `Bot ${k + 1}`,
      faction: HOUSES[(k + i) % HOUSES.length],
      start: plan[(k + i) % plan.length].start,
      ai: true,
    })),
  };
};

// `seat`: место → [поза, профиль]; не названное место играет 'expand' / 'strong'.
const CASES = [];
for (let i = 0; i < 4; i++) {
  CASES.push({
    name: `nexus-strong-vs-weak-${i}`,
    setup: nexusDuel(i, HOUSES[i % 4], HOUSES[(i + 1) % 4]),
    days: 14,
    seat: { p1: ['expand', 'strong'], p2: ['expand', 'weak'] },
  });
}
CASES.push({
  name: 'nexus-defend',
  setup: nexusDuel(5, 'azure', 'crimson'),
  days: 10,
  seat: { p1: ['expand', 'strong'], p2: ['defend', 'strong'] },
});
CASES.push({
  name: 'nexus-active-defend',
  setup: nexusDuel(6, 'amber', 'violet'),
  days: 10,
  seat: { p1: ['expand', 'strong'], p2: ['active_defend', 'weak'] },
});
for (let i = 0; i < 2; i++) {
  CASES.push({ name: `duel-1-${i}`, setup: onMap(i, 'duel-1'), days: 14, seat: {} });
  CASES.push({ name: `ffa-4-${i}`, setup: onMap(i, 'ffa-4'), days: 10, seat: {} });
}
CASES.push({ name: 'frontier-50', setup: onMap(0, 'frontier-50'), days: 4, seat: {} });
// Главы: место игрока p1 молчит, играют места забега (то же правило, что `decisions/runAiSeats`).
for (let m = 0; m < PVE_MISSION_COUNT; m++)
  CASES.push({ name: `pve-${m + 1}`, pve: m, days: 10, seat: {} });

const short = (h) => h.digest('hex').slice(0, 16);

function run(c) {
  let state;
  let ctx;
  let seats;
  if (c.pve !== undefined) {
    state = pveState(data, c.pve);
    setMatchMode(pveModeId(c.pve));
    setMatchTravelSpeed(5);
    setMatchVeteranPower(true);
    ctx = (now) => gameCtx(now, state);
    seats = Object.values(state.players)
      .filter((p) => p.id !== 'p1' && (!p.npc || p.ai === true))
      .map((p) => p.id);
  } else {
    setMatchMode(undefined);
    setMatchTravelSpeed(1);
    setMatchVeteranPower(false);
    state = newGame(c.setup);
    ctx = (now) => ({ now, data, config: victory(c.days) });
  }
  const all = createHash('sha256');
  const steps = [];
  const types = {};
  let orders = 0;
  let now = state.time ?? 0;
  const cap = now + (c.days + 1) * DAY;
  while (now < cap && state.match.status !== 'ended') {
    now += STEP;
    for (let k = 0; k < 10; k++) {
      const r = kernel.advanceTo(state, ctx(now));
      if (!r.ok) return { error: r.code };
      state = r.state;
      if (!r.partial) break;
    }
    if (state.match.status === 'ended') break;
    const step = createHash('sha256');
    for (const seat of seats ?? Object.keys(state.players)) {
      const [posture, profile] = c.seat[seat] ?? ['expand', 'strong'];
      const out = aiOrders(state, seat, posture, profile);
      all.update(`${now}|${seat}|${JSON.stringify(out)}\n`);
      step.update(`${now}|${seat}|${JSON.stringify(out.map((a) => [a.type, a.payload]))}\n`);
      orders += out.length;
      for (const a of out) {
        types[a.type] = (types[a.type] ?? 0) + 1;
        const r = kernel.applyAction(state, a, ctx(now));
        if (r.ok) state = r.state;
      }
    }
    steps.push(short(step).slice(0, 12));
  }
  return {
    orders,
    types: Object.fromEntries(Object.entries(types).sort()),
    digest: short(all),
    finalState: short(createHash('sha256').update(JSON.stringify(state))),
    steps,
  };
}

const trace = {};
for (const c of CASES) {
  const t0 = performance.now();
  const r = (trace[c.name] = run(c));
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `${c.name.padEnd(24)} orders=${String(r.orders).padStart(5)} kinds=${Object.keys(r.types ?? {}).length} digest=${r.digest} ${secs}s`,
  );
}
writeFileSync(OUT, JSON.stringify(trace, null, 1));

if (BEFORE) {
  const before = JSON.parse(readFileSync(BEFORE, 'utf8'));
  let diverged = 0;
  for (const [name, a] of Object.entries(trace)) {
    const b = before[name];
    if (!b) {
      console.log(`${name}: нет в ${BEFORE}`);
      diverged++;
      continue;
    }
    if (a.digest === b.digest && a.finalState === b.finalState) continue;
    diverged++;
    const at = a.steps.findIndex((s, i) => s !== b.steps[i]);
    console.log(`${name}: РАСХОЖДЕНИЕ${at < 0 ? ' (только id приказов)' : ` с шага ${at}`}`);
  }
  console.log(
    diverged === 0 ? `совпало: ${CASES.length} партий` : `расходится партий: ${diverged}`,
  );
  process.exit(diverged === 0 ? 0 : 1);
}
