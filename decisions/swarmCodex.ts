/**
 * ДОСЬЕ РОЯ В МЕНЮ — что игрок узнал о Рое за все забеги (заказ владельца 2026-09-24:
 * «в главном меню кнопка, где вся информация, известная игроку о Рое: какие модули, какие
 * юниты и т. д., чтобы подготовиться к забегу с учётом известного»).
 *
 * Досье в забеге (`swarmDossier.ts`) живёт внутри матча и пропадает с его концом. Здесь —
 * ПАМЯТЬ профиля: по итогам каждого завершённого забега в неё сливается то, что игрок
 * в нём узнал. Правила:
 *
 * 1. **Знание — только наблюдённое.** Форма Роя известна, если игрок опознал её в отряде
 *    (`swarmIntel`: состав виден только опознанным отрядам). Постройка — если она стоит в
 *    его памяти тумана на мире Роя. Правда состояния в досье не попадает.
 * 2. **Орган Роя известен по действию, а не по вскрытию.** Модули отряда игроку не
 *    видны. Завеса перехвата (`intercept`) открывается, когда Рой отразил его удар
 *    (`swarmJournal`); выводковая камера (`brood`) — когда он видел десант, которого
 *    выводит камера. Эти признаки — те же, что игрок сам наблюдал на карте.
 * 3. **Память только растёт.** Слияние берёт максимум и объединение: забег, в котором
 *    Роя не встретили, досье не стирает.
 * 4. **Каталог — из данных, не из памяти.** Что вообще бывает у Роя, знает каталог
 *    (формы волн и уникальные юниты фракции, органы, постройки на мирах Роя в главах);
 *    неизвестное показывается «?», чтобы было видно, что ещё предстоит узнать.
 *
 * Ни DOM, ни хранилища, ни текста — только ключи и числа (`/decisions/README.md`).
 */
import { moduleAllowed, type GameData, type GameState } from '../packages/shared-core/src/index';

/** Память профиля о Рое. */
export interface SwarmCodex {
  /** Опознанные формы: больше всего в одном отряде и в скольких забегах встречена. */
  units: Record<string, { max: number; runs: number }>;
  /** Постройки Роя, которые игрок видел. */
  buildings: string[];
  /** Сколько ударов игрока Рой отразил за все забеги. */
  repels: number;
  /** Самый сильный замеренный урон ПВО Роя в одном отражении. */
  veilDamage: number;
  /** Видел ли игрок высадку десанта Роя (признак выводковой камеры). */
  broodSeen: boolean;
}

export const emptySwarmCodex = (): SwarmCodex => ({
  units: {},
  buildings: [],
  repels: 0,
  veilDamage: 0,
  broodSeen: false,
});

/** Что вообще бывает у Роя — каталог досье (правило 4). */
export interface SwarmCatalog {
  units: string[];
  modules: string[];
  buildings: string[];
}

const SWARM = 'swarm';

/**
 * Каталог по данным и стартовым состояниям глав. Формы — уникальные юниты фракции Роя и
 * всё, что приходит волнами PvE; органы — модули, которые встают на эти формы; постройки
 * — стоящие на мирах Роя в главах. Порядок стабилен: как объявлено, без повторов.
 */
export function swarmCatalog(data: GameData, chapters: readonly GameState[]): SwarmCatalog {
  const units: string[] = [...(data.factions[SWARM]?.uniqueUnits ?? [])];
  for (const mode of Object.values(data.modes)) {
    const pve = mode.pve as { waveFleet?: unknown; waveLanding?: unknown } | undefined;
    if (!pve) continue;
    JSON.stringify([pve.waveFleet, pve.waveLanding], (key, value: unknown) => {
      if (key === 'unit' && typeof value === 'string') units.push(value);
      return value;
    });
  }
  const known = [...new Set(units)].filter((id) => data.units[id]);
  // Органы — модули, которые данные ЯВНО отдают носителю выводка (`allowed.traits`), а не
  // любой модуль, который встал бы на такой корпус: обычный двигатель органом Роя не станет.
  const hosts = known.filter((u) => data.units[u]!.traits.includes('brood_host'));
  const modules = Object.keys(data.modules).filter((m) => {
    const def = data.modules[m]!;
    return (
      (def.allowed?.traits ?? []).includes('brood_host') &&
      hosts.some((u) => moduleAllowed(u, data.units[u]!, def))
    );
  });
  const buildings: string[] = [];
  for (const state of chapters)
    for (const p of Object.values(state.planets))
      if (p.owner === SWARM) for (const b of p.buildings) buildings.push(b.type);
  return { units: known, modules, buildings: [...new Set(buildings)].sort() };
}

/** Юниты, которых выводит орган-камера (`brood.unit`): увидеть их — увидеть работу камеры. */
function broodUnits(data: GameData): Set<string> {
  const out = new Set<string>();
  for (const m of Object.values(data.modules)) {
    const unit = (m as { brood?: { unit?: unknown } }).brood?.unit;
    if (typeof unit === 'string') out.add(unit);
  }
  return out;
}

/** Что игрок узнал о Рое в одном забеге — слить в память (правила 1–3). */
export function learnSwarm(
  codex: SwarmCodex,
  state: GameState,
  player: string,
  data: GameData,
): SwarmCodex {
  const next: SwarmCodex = {
    units: { ...codex.units },
    buildings: [...codex.buildings],
    repels: codex.repels,
    veilDamage: codex.veilDamage,
    broodSeen: codex.broodSeen,
  };
  // Формы: максимум в одном отряде за этот забег, затем +1 забег на каждую встреченную.
  const inRun = new Map<string, number>();
  for (const contact of Object.values(state.swarmIntel?.[player] ?? {}))
    for (const { unit, count } of contact.units)
      if (count > 0) inRun.set(unit, Math.max(inRun.get(unit) ?? 0, count));
  for (const [unit, count] of inRun) {
    const was = next.units[unit];
    next.units[unit] = { max: Math.max(was?.max ?? 0, count), runs: (was?.runs ?? 0) + 1 };
  }
  const brood = broodUnits(data);
  if ([...inRun.keys()].some((u) => brood.has(u))) next.broodSeen = true;
  // Постройки: только то, что игрок помнит стоящим на мире Роя.
  const seen = new Set(next.buildings);
  for (const snap of Object.values(state.fog?.[player] ?? {}))
    if (snap.owner === SWARM) for (const b of snap.buildings) if (b.hp > 0) seen.add(b.type);
  next.buildings = [...seen].sort();
  const journal = state.swarmJournal?.[player];
  if (journal && journal.sorties > 0) {
    next.repels += journal.sorties;
    next.veilDamage = Math.max(next.veilDamage, journal.firstDamage, journal.lastDamage);
  }
  return next;
}

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : 0;

/** Разбор памяти из профиля. Мусор и чужие id отбрасываются, а не роняют профиль. */
export function parseSwarmCodex(raw: unknown, data: GameData): SwarmCodex {
  const out = emptySwarmCodex();
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  if (o.units && typeof o.units === 'object')
    for (const [id, v] of Object.entries(o.units as Record<string, unknown>)) {
      // Собственный ключ каталога (AUD-30): `data.units['__proto__']` — это `Object.prototype`.
      if (!Object.prototype.hasOwnProperty.call(data.units, id) || !v || typeof v !== 'object')
        continue;
      const e = v as Record<string, unknown>;
      const max = count(e.max);
      if (max > 0) out.units[id] = { max, runs: Math.max(1, count(e.runs)) };
    }
  if (Array.isArray(o.buildings))
    out.buildings = [
      ...new Set(
        o.buildings.filter(
          (b): b is string =>
            typeof b === 'string' && Object.prototype.hasOwnProperty.call(data.buildings, b),
        ),
      ),
    ].sort();
  out.repels = count(o.repels);
  out.veilDamage = count(o.veilDamage);
  out.broodSeen = o.broodSeen === true;
  return out;
}

/** Строки досье для меню: каталог с отметкой «известно» и тем, что известно. */
export interface SwarmCodexView {
  units: Array<{ id: string; known: boolean; max: number; runs: number }>;
  modules: Array<{ id: string; known: boolean; evidence: 'intercept' | 'brood' | null; n: number }>;
  buildings: Array<{ id: string; known: boolean }>;
  known: number;
  total: number;
}

export function swarmCodexView(
  codex: SwarmCodex,
  catalog: SwarmCatalog,
  data: GameData,
): SwarmCodexView {
  const units = catalog.units.map((id) => {
    const e = codex.units[id];
    return { id, known: !!e, max: e?.max ?? 0, runs: e?.runs ?? 0 };
  });
  // Орган известен по действию (правило 2): камера — по десанту, завеса — по отражённым
  // ударам. Кто есть кто, говорят данные (`brood`, адаптация на сигнал `strike`), а не id;
  // орган без наблюдаемого признака остаётся «?».
  const modules = catalog.modules.map((id) => {
    const def = data.modules[id] as
      | { brood?: unknown; adaptation?: { signal?: string } }
      | undefined;
    const evidence = def?.brood
      ? codex.broodSeen
        ? ('brood' as const)
        : null
      : def?.adaptation?.signal === 'strike' && codex.repels > 0
        ? ('intercept' as const)
        : null;
    return { id, known: evidence !== null, evidence, n: evidence === 'intercept' ? codex.repels : 0 };
  });
  const buildings = catalog.buildings.map((id) => ({ id, known: codex.buildings.includes(id) }));
  const all = [...units, ...modules, ...buildings];
  return { units, modules, buildings, known: all.filter((x) => x.known).length, total: all.length };
}
