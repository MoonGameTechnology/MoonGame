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

/** Последнее известное состояние мира: владелец, численность гарнизона, постройки. */
export interface Snapshot {
  owner: string | null;
  garrison: number;
  buildings: Array<{ type: string; level: number }>;
}

/** Снимок мира на момент опознания — копия, живое состояние за ним не тянется. */
export function snapshotOf(p: Planet): Snapshot {
  return {
    owner: p.owner,
    garrison: p.garrison.reduce((n, st) => n + st.count, 0),
    buildings: p.buildings.map((b) => ({ type: b.type, level: b.level })),
  };
}

/** Память разведки одного зрителя. */
export interface ScanMemory {
  /** Записать снимки опознанных узлов. Радарные сюда попадать не должны. */
  remember(identify: Iterable<string>, planets: Record<string, Planet | undefined>): void;
  get(id: string): Snapshot | undefined;
  has(id: string): boolean;
  /** Последний известный владелец узла — `null`, если помним его ничейным или не помним. */
  ownerOf(id: string): string | null;
  /** Забыть всё: память принадлежит матчу. */
  clear(): void;
}

/** Завести память разведки. Внутри обычная карта — состояние живёт здесь, не в хозяине. */
export function createScanMemory(): ScanMemory {
  const seen = new Map<string, Snapshot>();
  return {
    remember(identify, planets) {
      for (const id of identify) {
        const p = planets[id];
        if (p) seen.set(id, snapshotOf(p));
      }
    },
    get: (id) => seen.get(id),
    has: (id) => seen.has(id),
    ownerOf: (id) => seen.get(id)?.owner ?? null,
    clear: () => seen.clear(),
  };
}
