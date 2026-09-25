/**
 * Маршрут глав Sector Zero (PVR-6.9): от края сектора к эпицентру заражения.
 *
 * Кампания задумана из шести глав (`docs/sector-zero-map-concepts.md` §2: MAP-01 «Заглохший
 * сигнал» → … → MAP-06 «Нулевой комплекс»), а играбельных сегодня меньше. Экран рисует весь
 * путь, чтобы было видно, КУДА он ведёт, но ещё не сделанные главы — безымянным узлом
 * «сигнал потерян»: названия в концепте рабочие (§13), и обещанное имя потом пришлось бы
 * менять на глазах у игрока.
 */

/** Длина пути — число глав кампании по концепту. Играбельных больше — путь удлиняется. */
export const ROUTE_LENGTH = 6;

/** Ключи названия и брифинга играбельных глав, по порядку. Ключ — литерал, а не шаблон:
 *  так сторож локализации видит каждый. Новая глава = строка здесь + ключи в локалях. */
export const CHAPTER_KEYS: readonly { name: string; brief: string }[] = [
  { name: 'sector-zero.mission.1', brief: 'sector-zero.mission.1.brief' },
  { name: 'sector-zero.mission.2', brief: 'sector-zero.mission.2.brief' },
  { name: 'sector-zero.mission.3', brief: 'sector-zero.mission.3.brief' },
];

export interface RouteNode {
  /** Номер главы (0 — у края сектора). */
  index: number;
  /** Можно ли её выбрать: есть карта главы и её тексты. */
  playable: boolean;
  /** Последний узел — эпицентр. */
  core: boolean;
}

/**
 * Узлы пути. `playable` — сколько глав есть в игре (`PVE_MISSION_COUNT`); глава без текстов в
 * {@link CHAPTER_KEYS} играбельной не считается — безымянная кнопка хуже «сигнал потерян».
 * Мусор на входе даёт путь без играбельных глав, а не исключение.
 */
export function chapterRoute(playable: number): RouteNode[] {
  const open = Math.min(
    CHAPTER_KEYS.length,
    Math.max(0, Math.floor(Number.isFinite(playable) ? playable : 0)),
  );
  const length = Math.max(ROUTE_LENGTH, open);
  return Array.from({ length }, (_, index) => ({
    index,
    playable: index < open,
    core: index === length - 1,
  }));
}

/** Римская цифра номера главы на узле (1…39 хватает с запасом). */
export function romanChapter(index: number): string {
  const n = Math.max(1, Math.floor(index) + 1);
  const tens = ['', 'X', 'XX', 'XXX'][Math.min(3, Math.floor(n / 10))]!;
  const ones = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][n % 10]!;
  return tens + ones;
}
