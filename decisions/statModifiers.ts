/**
 * Надбавки к параметрам флота: в какой цвет красить число и что показать по тапу.
 *
 * Игрок видит у флота атаку, защиту, скорость, корпус и щит, но бой идёт не на этих
 * числах: их двигают технологии, фракция, герой, местность, выслуга. Окно показывало
 * голую сумму по кораблям, и ни «+10% урона» фракции, ни «−50% хода» от пробитого
 * корпуса нигде не читались. Заказ владельца 2026-09-27: бафы — зелёным, перевесили
 * дебафы — красным, по тапу — кто именно двигает параметр.
 *
 * 1. **Источник — ядро, а не своя таблица.** Модуль не знает ни одной надбавки: вход —
 *    разбор конвейеров хуков (`Kernel.traceHooks`), тех самых, по которым считает бой.
 *    Своя таблица «фракция = +10%» разошлась бы с боем при первой правке баланса, и
 *    разошлась бы молча.
 * 2. **У атаки и защиты один множитель.** В бою стреляют обе: атака — залп нападающего,
 *    защита — ответный огонь обороняющегося, и оба выстрела проходят `hookedDamage` с
 *    нашим флотом в `attacker`. Поэтому надбавки общие: последовательная группа
 *    перемножается, массовая складывается очками и тратится один раз (`util/combat.ts`,
 *    `× Π(sequential) × (1 + Σ parallel)`). Снижение урона ЦЕЛИ сюда не входит — это
 *    параметр чужого флота, а не нашего.
 * 3. **У корпуса и щита — входящий урон.** Их надбавка — насколько меньше урона флот
 *    получает: пул снижения `combat.mitigation` (флот — защищающийся) и множители,
 *    которые ядро вешает на сторону ПОД огнём. Пул тратится один раз, поэтому вклад
 *    каждого источника показан так, будто он один, — сумма строк честно не равна итогу,
 *    и итог стоит отдельной строкой. Цвет здесь обратный: меньше урона — зелёный.
 * 4. **Хромота — дебаф хода, хотя хука у неё нет.** Ход ниже 30% корпуса режется в базе
 *    (`fleetBaseSpeed`), а не в хуке. Игрок же видит «скорость упала» и спрашивает
 *    почему, поэтому база здесь НОМИНАЛЬНАЯ (без повреждений), а разница с фактической —
 *    отдельной строкой.
 * 5. **Цвет — по итогу, а не по наличию.** Итог выше базы — бафы, ниже — дебафы
 *    перевесили, равен — нейтрально. Порог в полпроцента: дробь от округления не должна
 *    красить число.
 * 6. **Позиция — там, где флот стоит сейчас.** На стоянке выстрел приписан узлу (домашний
 *    сектор, радиус героя); в пути узла нет, и привязанные к узлу надбавки не
 *    показываются. Ход на стоянке спрашивается без узла прибытия: среду следующего
 *    перехода ядро берёт по месту назначения, а оно ещё не выбрано.
 */
import {
  mitigationFromPool,
  type Fleet,
  type HookQuery,
  type HookTrace,
} from '../packages/shared-core/src/index';

export type StatTone = 'buff' | 'debuff' | 'neutral';

/** Строка всплывашки: кто и насколько. `pct` — знаковые проценты к тому, что шаг получил. */
export interface StatSource {
  source: string;
  pct: number;
}

export interface StatBreakdown {
  /** База без надбавок: для множителей — 1, для хода — номинальная скорость. */
  base: number;
  value: number;
  /** Итог к базе: 1.1 — «+10%». */
  factor: number;
  sources: StatSource[];
  tone: StatTone;
}

export interface FleetStatMods {
  /** Общий множитель атаки и защиты (правило 2). */
  fire: StatBreakdown;
  speed: StatBreakdown;
  /** Множитель входящего урона (правило 3): меньше 1 — флот получает меньше. */
  incoming: StatBreakdown;
}

/** Псевдоисточник хромоты (правило 4): модуля у неё нет, строка во всплывашке есть. */
export const LIMP_SOURCE = 'limp';

/** Фаза стычки флотов — ею ядро помечает выстрелы кораблей по кораблям. */
const FLEET_PHASE = 'orbital';

/** Порог правила 5, в долях. */
const TONE_EPS = 0.005;

/** Шаг, сдвинувший значение меньше чем на двадцатую процента, — шум, а не надбавка. */
const NOISE_PCT = 0.05;

/**
 * Что спросить у ядра про флот. Порядок ответов — порядок запросов, его и читает
 * {@link fleetStatMods}. `speedBase` — фактический ход (`fleetBaseSpeed`, хромота учтена):
 * ровно то, что ядро кладёт в `fleet.speed`, без множителя режима партии.
 */
export function fleetStatQueries(fleet: Fleet, speedBase: number): HookQuery[] {
  const location = fleet.movement ? '' : (fleet.location ?? '');
  const shot = {
    phase: FLEET_PHASE,
    location,
    ...(fleet.battleId != null ? { battleId: fleet.battleId } : {}),
  };
  const firing = { ...shot, attacker: fleet.owner, defender: null, attackerFleet: fleet.id };
  // Под огнём — сам флот (`defenderFleet`): прикрытие бывает у одного флота, а не у
  // владельца, — орудия крепости прикрывают её постройки (FORT-5.16).
  const underFire = { ...shot, attacker: null, defender: fleet.owner, defenderFleet: fleet.id };
  const leg = fleet.movement
    ? { from: fleet.movement.from, to: fleet.movement.to }
    : { from: location };
  return [
    { name: 'combat.damage', base: 1, args: firing },
    { name: 'combat.damage.parallel', base: 0, args: firing },
    { name: 'fleet.speed', base: speedBase, args: { fleetId: fleet.id, ...leg } },
    { name: 'combat.damage', base: 1, args: underFire },
    { name: 'combat.mitigation', base: 0, args: underFire },
  ];
}

const QUERY_COUNT = 5;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Проценты шага множителя: ×1.05 → +5. */
const factorPct = (before: number, after: number): number =>
  before !== 0 ? (after / before - 1) * 100 : 0;

/** Сложить строки одного модуля (он может вкладываться в обе группы урона). */
function merge(rows: readonly StatSource[]): StatSource[] {
  const out: StatSource[] = [];
  for (const row of rows) {
    const seen = out.find((r) => r.source === row.source);
    if (seen) seen.pct += row.pct;
    else out.push({ ...row });
  }
  return out.filter((r) => Math.abs(r.pct) >= NOISE_PCT);
}

function multiplied(trace: HookTrace): StatSource[] {
  return trace.steps.map((s) => ({ source: s.module, pct: factorPct(num(s.before), num(s.after)) }));
}

function toneOf(factor: number, lessIsBetter = false): StatTone {
  const delta = lessIsBetter ? 1 - factor : factor - 1;
  return delta > TONE_EPS ? 'buff' : delta < -TONE_EPS ? 'debuff' : 'neutral';
}

/**
 * Разбор ответа ядра на {@link fleetStatQueries}. `null` — ядро не ответило (подписчик
 * упал, `traceHooks` вернул `null`): тогда параметры показываются без окраски, а не с
 * выдуманной.
 */
export function fleetStatMods(
  traces: readonly HookTrace[] | null,
  nominalSpeed: number,
): FleetStatMods | null {
  if (!traces || traces.length !== QUERY_COUNT) return null;
  const [seq, par, speed, hit, pool] = traces as [HookTrace, HookTrace, HookTrace, HookTrace, HookTrace];

  const seqFactor = num(seq.base) !== 0 ? num(seq.value) / num(seq.base) : 1;
  const fireFactor = seqFactor * (1 + num(par.value));
  const fire: StatBreakdown = {
    base: 1,
    value: fireFactor,
    factor: fireFactor,
    sources: merge([
      ...multiplied(seq),
      ...par.steps.map((s) => ({ source: s.module, pct: (num(s.after) - num(s.before)) * 100 })),
    ]),
    tone: toneOf(fireFactor),
  };

  const actual = num(speed.base);
  const limp: StatSource[] =
    nominalSpeed > 0 && actual < nominalSpeed
      ? [{ source: LIMP_SOURCE, pct: factorPct(nominalSpeed, actual) }]
      : [];
  const speedFactor = nominalSpeed > 0 ? num(speed.value) / nominalSpeed : 1;
  const speedMods: StatBreakdown = {
    base: nominalSpeed,
    value: num(speed.value),
    factor: speedFactor,
    sources: merge([...limp, ...multiplied(speed)]),
    tone: toneOf(speedFactor),
  };

  const hitFactor = num(hit.base) !== 0 ? num(hit.value) / num(hit.base) : 1;
  const inFactor = hitFactor * mitigationFromPool(num(pool.value));
  const incoming: StatBreakdown = {
    base: 1,
    value: inFactor,
    factor: inFactor,
    sources: merge([
      ...multiplied(hit),
      ...pool.steps.map((s) => ({
        source: s.module,
        pct: (mitigationFromPool(num(s.after) - num(s.before)) - 1) * 100,
      })),
    ]),
    tone: toneOf(inFactor, true),
  };

  return { fire, speed: speedMods, incoming };
}

/**
 * Подпись источника — КЛЮЧ локали, не текст. Незнакомый модуль (новый подписчик хука)
 * не прячется, а подписывается «прочее»: число он всё равно двигает. Хромота —
 * псевдоисточник правила 4.
 */
const SOURCE_KEYS: Readonly<Record<string, string>> = {
  technology: 'stat.src.technology',
  faction: 'stat.src.faction',
  hero: 'stat.src.hero',
  heroEffects: 'stat.src.hero-effects',
  sector: 'stat.src.sector',
  station: 'stat.src.station',
  veteran: 'stat.src.veteran',
  promotion: 'stat.src.promotion',
  'forced-march': 'stat.src.forced-march',
  // У модуля боя в этих конвейерах один вклад — спешный отход (`fleet.speed`).
  combat: 'stat.src.retreat',
  [LIMP_SOURCE]: 'stat.src.limp',
};

export const OTHER_SOURCE_KEY = 'stat.src.other';

export function statSourceKey(source: string): string {
  return Object.hasOwn(SOURCE_KEYS, source) ? SOURCE_KEYS[source]! : OTHER_SOURCE_KEY;
}

/** Все ключи подписей — для теста, что каждый заведён в локалях. */
export const STAT_SOURCE_KEYS: readonly string[] = [...Object.values(SOURCE_KEYS), OTHER_SOURCE_KEY];

/** Знаковые проценты для строки: «+10%», «−13%», «+0.5%». Минус — типографский. */
export function pctText(pct: number): string {
  const abs = Math.abs(pct);
  const shown = abs >= 1 ? String(Math.round(abs)) : String(Math.round(abs * 10) / 10);
  if (shown === '0') return '0%';
  return `${pct > 0 ? '+' : '−'}${shown}%`;
}
