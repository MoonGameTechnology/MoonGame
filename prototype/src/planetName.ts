/**
 * Авто-имена мирам — как у флотов (fleetName.ts), но для планет: вместо голой
 * сеточной координаты («C2R1») мир получает узнаваемое собственное имя. Имя ВЫВОДИТСЯ
 * из id мира и списка миров его карты: одна карта → одни имена на всех клиентах, без
 * ядра и без `Math.random`. Координату игрок не видит (UIX-5.2): её показывает только
 * карточка мира в режиме отладки.
 *
 * Формат: `{ИМЯ}-{N}` — латиница (нейтральна к локали, как позывные флотов),
 * мифо-астрономический колорит; номер различает миры с одним именем (`worldNames`).
 */

import { isForkSite, type GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { provinceName } from '../../decisions/provinceName';

/** Мифо-астрономические собственные имена миров (латиница — нейтральны к локали). */
export const PLANET_NAMES = [
  'HELIOS',
  'CERBERUS',
  'ARCADIA',
  'TARTARUS',
  'EREBUS',
  'PANDORA',
  'AVALON',
  'VALHALLA',
  'OLYMPUS',
  'HYPERION',
  'TRITON',
  'CERES',
  'VESTA',
  'ICARUS',
  'DAEDALUS',
  'PROMETHEUS',
  'ATLAS',
  'KRONOS',
  'RHEA',
  'PHOBOS',
  'DEIMOS',
  'CHARON',
  'STYX',
  'LETHE',
  'MORPHEUS',
  'NYX',
  'GAIA',
  'PONTUS',
  'TETHYS',
  'THEMIS',
  'METIS',
  'SELENE',
  'ASTRAEA',
  'HESPERA',
  'ORION',
  'LYRA',
] as const;

/** Детерминированный 32-битный хэш строки (FNV-1a) — без Math.random. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Имя мира `{ИМЯ}-{N}` (N = 1..9) из хэша его id — без оглядки на соседей по карте. */
export function planetName(id: string): string {
  const h = hashStr(id);
  const name = PLANET_NAMES[h % PLANET_NAMES.length]!;
  const num = (Math.floor(h / PLANET_NAMES.length) % 9) + 1;
  return `${name}-${num}`;
}

/**
 * Имена всех миров карты разом — без повторов (UIX-5.2). Хэш даёт 324 имени (36 × 9), и
 * совпадения на картах не редкость: на «Нексусе» 15 имён стояли на двух-трёх мирах сразу
 * («STYX-3» — и C0R2, и C2R4), на фронтире миров больше, чем имён. Игрок искал мир по имени
 * и находил не тот.
 *
 * Миры обходятся по id (сравнение кодов, без локали), поэтому у одной карты таблица одна
 * на всех клиентах. Имя `planetName` остаётся за первым миром, у кого оно вышло; остальные
 * берут ближайший свободный номер того же имени: до 9 по кругу, затем 10, 11 и дальше.
 * Номера раздаются вторым проходом, поэтому мир без совпадения своё имя не теряет.
 */
export function worldNames(ids: Iterable<string>): ReadonlyMap<string, string> {
  const taken = new Set<string>();
  const names = new Map<string, string>();
  const rest: string[] = [];
  for (const id of [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const name = planetName(id);
    if (taken.has(name)) rest.push(id);
    else {
      taken.add(name);
      names.set(id, name);
    }
  }
  for (const id of rest) {
    const h = hashStr(id);
    const base = PLANET_NAMES[h % PLANET_NAMES.length]!;
    const first = Math.floor(h / PLANET_NAMES.length) % 9;
    let k = 1;
    let name = `${base}-${((first + k) % 9) + 1}`;
    while (taken.has(name)) {
      k += 1;
      name = `${base}-${k < 9 ? ((first + k) % 9) + 1 : k + 1}`;
    }
    taken.add(name);
    names.set(id, name);
  }
  return names;
}

/** Таблица текущей карты. Состояние партии сменяется каждый кадр, а её миры — нет: таблица
 *  строится заново, только когда сменился сам набор миров. */
let cached: { planets: GameState['planets']; names: ReadonlyMap<string, string> } | null = null;
function namesOf(planets: GameState['planets']): ReadonlyMap<string, string> {
  if (cached?.planets === planets) return cached.names;
  // Крепость на развилке (FORT-6.1) номер не занимает: построенная посреди партии, она
  // сдвинула бы имена соседей.
  const ids = Object.keys(planets).filter((id) => !isForkSite(planets[id]));
  const prev = cached?.names;
  const same = prev !== undefined && prev.size === ids.length && ids.every((id) => prev.has(id));
  cached = { planets, names: same ? prev : worldNames(ids) };
  return cached.names;
}

/** Имя мира для игрока — одно на всех экранах (UIX-5.2): подпись на карте, журнал, окно боя,
 *  стройка, верфь, метки. У провинции главы — её имя (PVR-6.19, `decisions/provinceName.ts`),
 *  у карт без имён — авто-имя без повторов (`worldNames`). Крепость на развилке (FORT-6.1) —
 *  не провинция: её имя по провинции её развилки. Узла нет на карте — остаётся его id:
 *  выдуманное имя назвало бы мир, которого нет. */
export function worldName(state: Pick<GameState, 'mapId' | 'planets'>, id: string): string {
  const fork = state.planets[id]?.fork;
  if (fork) return t('place.fork-fortress', { planet: worldName(state, fork.province) });
  return provinceName(state.mapId, id) ?? namesOf(state.planets).get(id) ?? id;
}

const nodeNames = new WeakMap<readonly { id: string }[], ReadonlyMap<string, string>>();
/** То же по узлам карты — для настройки матча, где партии ещё нет. Партия строит миры из
 *  тех же узлов, поэтому и имена в ней те же. */
export function mapWorldName(mapId: string, nodes: readonly { id: string }[], id: string): string {
  let names = nodeNames.get(nodes);
  if (!names) nodeNames.set(nodes, (names = worldNames(nodes.map((n) => n.id))));
  return provinceName(mapId, id) ?? names.get(id) ?? id;
}
