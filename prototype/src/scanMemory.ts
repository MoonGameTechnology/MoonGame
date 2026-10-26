/**
 * Память разведки: что игрок ПОМНИТ о мире, который больше не видит (REFM-43).
 *
 * Туман здесь варианта B: единожды опознанный узел не пропадает совсем — он остаётся
 * на карте и в панели последним известным состоянием, тускло. Три правила, каждое из
 * которых при нарушении выдаёт игроку то, чего он не видел:
 *
 * 1. **Пишутся только ОПОЗНАННЫЕ узлы.** Радар даёт сигнатуру («там что-то большое»),
 *    а не состав. Записать радарный узел в память значит показать гарнизон и постройки,
 *    которые никто не разглядывал.
 * 2. **Снимок — КОПИЯ, а не ссылка на живой мир.** Иначе «последнее известное»
 *    менялось бы вместе с настоящим, и память показывала бы текущее состояние чужого
 *    мира сквозь туман — утечка, которую на глаз не поймать: цифры-то правдоподобные.
 * 3. **Память принадлежит МАТЧУ.** Новая партия начинается с чистой памяти, иначе
 *    разведка прошлой игры протечёт в следующую.
 */
import type { Planet } from '../../packages/shared-core/src/index';

/** Последнее известное состояние мира: владелец, гарнизон, постройки и среда. */
export interface Snapshot {
  owner: string | null;
  garrison: number;
  buildings: Array<{ type: string; level: number }>;
  /** Last identified physical environment; absent on older saved snapshots. */
  environment?: { kind?: string; terrain?: string };
}

/** Снимок мира на момент опознания — копия, живое состояние за ним не тянется. */
export function snapshotOf(p: Planet): Snapshot {
  return {
    owner: p.owner,
    garrison: p.garrison.reduce((n, st) => n + st.count, 0),
    buildings: p.buildings.map((b) => ({ type: b.type, level: b.level })),
    environment: { kind: p.kind, terrain: p.terrain },
  };
}

/** Память разведки одного зрителя. */
export interface ScanMemory {
  /** Записать снимки опознанных узлов. Радарные сюда попадать не должны. Узел, чей
   *  нынешний снимок снят с этого же объекта мира, заново не снимается: мир не правят на
   *  месте, а заменяют, и тот же объект — тот же снимок. */
  remember(identify: Iterable<string>, planets: Record<string, Planet | undefined>): void;
  /** Мир правили на месте (песочница): следующая запись снимает опознанные узлы заново,
   *  даже с того же объекта. */
  retake(): void;
  get(id: string): Snapshot | undefined;
  has(id: string): boolean;
  /** Последний известный владелец узла — `null`, если помним его ничейным или не помним. */
  ownerOf(id: string): string | null;
  /** Номер правки памяти: растёт с каждой записью, очисткой и восстановлением. Пока он
   *  прежний, прежнее и всё, что из памяти читают. */
  version(): number;
  /** Забыть всё: память принадлежит матчу. */
  clear(): void;
  dump(): Array<[string, Snapshot]>;
  restore(entries: Array<[string, Snapshot]>): void;
}

/** Завести память разведки. Внутри обычная карта — состояние живёт здесь, не в хозяине. */
export function createScanMemory(): ScanMemory {
  const seen = new Map<string, Snapshot>();
  // С какого объекта мира снят какой снимок. Новый мир от потока расчёта или сервера
  // (`applyDelta`) несёт прежние объекты миров, которые не менялись, а открытая карта
  // опознаёт все 1675 миров frontier-100: без этой проверки каждый новый мир снимался бы
  // заново целиком. Слабая карта не держит старые миры живыми. Очистка и восстановление
  // её не трогают: снимков, которые она помнит, в памяти после них нет, и узел снимется
  // заново.
  let taken = new WeakMap<Planet, Snapshot>();
  let version = 0;
  return {
    remember(identify, planets) {
      version++;
      for (const id of identify) {
        const p = planets[id];
        if (!p) continue;
        const prev = seen.get(id);
        if (prev !== undefined && taken.get(p) === prev) continue;
        const snap = snapshotOf(p);
        seen.set(id, snap);
        taken.set(p, snap);
      }
    },
    retake: () => {
      taken = new WeakMap();
    },
    get: (id) => seen.get(id),
    has: (id) => seen.has(id),
    ownerOf: (id) => seen.get(id)?.owner ?? null,
    version: () => version,
    clear: () => {
      version++;
      seen.clear();
    },
    dump: () => [...seen].map(([id, snap]) => [id, structuredClone(snap)]),
    restore(entries) {
      version++;
      seen.clear();
      for (const [id, snap] of entries) seen.set(id, structuredClone(snap));
    },
  };
}
