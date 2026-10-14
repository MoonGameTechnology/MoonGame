// PTM-2.1 (docs/playtest-telemetry-roadmap.md): `pnpm run analytics` — the behaviour
// report after a network test: funnel, link health, load time, errors, sessions,
// retention, survival, rejected actions, invite tags, and one tester's timeline.
//
//   pnpm run analytics                                   # every day in playtest-logs/
//   pnpm run analytics -- --from 2026-10-14 --to 2026-10-20
//   pnpm run analytics -- --person <actor|install:id>   # that tester's timeline
//   pnpm run analytics -- --dir /path/to/logs --gone 7  # where, and days of silence = gone
//
// Reads `client-YYYY-MM-DD.jsonl` (browser events, PTM-1.x) and `match-YYYY-MM-DD.jsonl`
// (match journal, PTM-0.1). Reads only; safe on a live log; torn lines are skipped.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  activity,
  connection,
  errors,
  funnel,
  loading,
  personSources,
  powerCurve,
  retention,
  sessions,
  survival,
  taskSuccess,
  utcDay,
} from './analytics.mjs';

function parseArgs(argv) {
  const out = { dir: 'playtest-logs', from: undefined, to: undefined, person: undefined, gone: 7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--person') out.person = argv[++i];
    else if (a === '--gone') out.gone = Number(argv[++i]);
  }
  for (const d of [out.from, out.to])
    if (d !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`дата ждёт YYYY-MM-DD, получено «${d}»`);
  if (!Number.isInteger(out.gone) || out.gone < 1) throw new Error('--gone ждёт целое число дней ≥ 1');
  return out;
}

function readJournal(dir, prefix, from, to) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const re = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.jsonl$`);
  const lines = [];
  for (const name of names.sort()) {
    const day = re.exec(name)?.[1];
    if (!day || (from && day < from) || (to && day > to)) continue;
    for (const raw of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (!raw) continue;
      try {
        lines.push(JSON.parse(raw));
      } catch {
        /* a torn line from a crash — skip it, keep the rest */
      }
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

const args = parseArgs(process.argv.slice(2));
const client = readJournal(args.dir, 'client', args.from, args.to);
const match = readJournal(args.dir, 'match', args.from, args.to);
if (client.length === 0) {
  console.log(`В ${args.dir} нет client-*.jsonl за выбранные дни — браузерных событий не было.`);
  process.exit(0);
}
const people = activity(client, match);
const lastT = Math.max(client.at(-1).t, match.at(-1)?.t ?? 0);
const out = [];
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const num = (x, unit = '') => (x === null || x === undefined ? '—' : `${Math.round(x)}${unit}`);

if (args.person) {
  const list = people.get(args.person);
  if (!list) {
    console.log(`Человека «${args.person}» нет. Есть: ${[...people.keys()].join(', ')}`);
    process.exit(1);
  }
  out.push(`Лента ${args.person} — ${list.length} событий`);
  for (const e of list) {
    const props = Object.entries(e.p ?? {}).map(([k, v]) => `${k}=${v}`).join(' ');
    out.push(`  ${new Date(e.t).toISOString().replace('T', ' ').slice(0, 19)}  ${e.e}${props ? `  ${props}` : ''}`);
  }
  console.log(out.join('\n'));
  process.exit(0);
}

out.push(`Поведение игроков · ${utcDay(client[0].t)} … ${utcDay(lastT)} · людей ${people.size}`);
out.push('', 'Воронка (люди, медиана минут от открытия):');
const f = funnel(people);
const min1 = (x) => (x === null ? '—' : `${x.toFixed(1)} мин`);
for (const s of f.steps) out.push(`  ${s.step.padEnd(13)} ${String(s.people).padStart(5)}   ${min1(s.medianMin)}`);
out.push(`  вернулся во 2-й день ${String(f.returned).padStart(5)}`);

const src = personSources(client);
const tags = [...new Set(src.values())];
if (tags.length > 1) {
  out.push('', 'Воронка по метке приглашения (открыл → вошёл → в партии):');
  for (const tag of tags) {
    const subset = new Map([...people].filter(([p]) => src.get(p) === tag));
    const s = funnel(subset).steps;
    out.push(`  ${tag.padEnd(12)} ${s[0].people} → ${s[2].people} → ${s[4].people}`);
  }
}

const k = connection(client);
out.push('', 'Связь:');
out.push(`  подключений ${k.connects} · переподключений ${k.reconnects} · обрывов на сессию ${k.dropsPerSession.toFixed(2)}`);
out.push(`  до впуска p50 ${num(k.connectMs.p50, ' мс')} · p95 ${num(k.connectMs.p95, ' мс')}`);
if (k.closeCodes.length) out.push(`  коды обрыва: ${k.closeCodes.map(([c, n]) => `${c}×${n}`).join(', ')}`);
if (k.loginFailed.length) out.push(`  отказы входа: ${k.loginFailed.map(([c, n]) => `${c}×${n}`).join(', ')}`);

const l = loading(client);
out.push('', 'Загрузка (до готовой игры):');
out.push(`  телефоны    n=${l.mobile.n} · p50 ${num(l.mobile.p50, ' мс')} · p95 ${num(l.mobile.p95, ' мс')}`);
out.push(`  компьютеры  n=${l.desktop.n} · p50 ${num(l.desktop.p50, ' мс')} · p95 ${num(l.desktop.p95, ' мс')}`);

const errs = errors(client);
out.push('', `Ошибки браузера: ${errs.length ? '' : 'нет'}`);
for (const e of errs.slice(0, 10)) out.push(`  ${e.key}  ×${e.n} в ${e.sessions} сесс.`);

const s = sessions(client);
out.push('', 'Сессии (загрузки страницы):');
out.push(`  всего ${s.count} · длина p50 ${num(s.minutes.p50, ' мин')} · p75 ${num(s.minutes.p75, ' мин')} · p90 ${num(s.minutes.p90, ' мин')}`);
out.push(`  в день на человека (медиана) ${s.perPersonDay ?? '—'}`);
out.push(`  паузы между сессиями: ${Object.entries(s.gaps).map(([b, n]) => `${b} ${n}`).join(' · ')}`);

out.push('', 'Удержание по когорте первого дня (только закрытые окна):');
for (const r of retention(people, lastT))
  out.push(`  D${String(r.n).padEnd(3)} в день ${pct(r.day).padStart(5)} · в день или позже ${pct(r.unbounded).padStart(5)}  (из ${r.eligible})`);
out.push(`  активных дней на человека: ${powerCurve(people).map(([d, n]) => `${d}д×${n}`).join(' · ')}`);
out.push(`  ещё играют (Каплан–Мейер, ушёл = ${args.gone} дн. тишины): ${survival(people, lastT, args.gone).map((x) => `д${x.day} ${pct(x.survival)}`).join(' · ')}`);

const ts = taskSuccess(people);
if (ts.length) {
  out.push('', 'Отказы действий (доля, топ кодов):');
  for (const r of ts.slice(0, 15))
    out.push(`  ${r.person.padEnd(18)} ${pct(r.rejectRate).padStart(5)} из ${r.actions}  ${r.codes.map(([c, n]) => `${c}×${n}`).join(', ')}`);
}
out.push('', 'Лента одного тестера: pnpm run analytics -- --person <id>');
console.log(out.join('\n'));
