/**
 * RANGE-UX — что за круги рисуются вокруг выделенных флотов и миров: радиус эскадрильи
 * и зубы ПКО.
 *
 * Чистая функция, а не рисование по месту, по трём причинам сразу:
 *  · РАДИУС БЕРЁТСЯ ИЗ ЯДРА. `shuttleStrikeRange` — та самая функция, по которой ядро
 *    считает вылет. Своя копия формулы в клиенте разъехалась бы на первой правке
 *    (дальность идёт через `effectiveStats`, то есть модули корабля её меняют), и игрок
 *    целился бы по одному кругу, а вылет шёл бы по другому.
 *  · ОДНО ОПИСАНИЕ НА ОБА ВИДА. Раньше каждый радиус рисовался бы своим блоком в
 *    `main.ts`; здесь это один список `RangeRing`, и добавить третий вид — строка.
 *  · ЭТО ТЕСТИРУЕМО. `main.ts` — DOM-вход без юнит-харнеса, а разметка кругов —
 *    обычная арифметика над состоянием; вынесенная, она накрывается гейтом.
 *
 * Про ПКО отдельно. У него НЕТ радиуса: `orbital.ts` бьёт по флотам, стоящим НА этом
 * узле (`f.location === planetId`). Рисовать ему круг было бы враньём, поэтому ПКО
 * обозначается кольцом на самом мире — «у этого мира есть зубы», — а не областью.
 *
 * ВИД КОЛЬЦА (REFM-123) — здесь же. Дом у кольца ОДИН: раньше тот же радиус рисовал ещё
 * и маркер выбранного флота, своим цветом и своим пунктиром, — два кольца одно поверх
 * другого каждый кадр. ПКО при этом заметнее радиусов: у него нет области, это отметка
 * на мире, и утони она в фоне — «зубы» стали бы незаметны ровно там, где за них платят
 * кораблями.
 */
import {
  hasOrbit,
  shuttleStrikeRange,
  squadronReach,
  type Fleet,
  type GameData,
  type GameState,
  type Squadron,
} from '../../packages/shared-core/src/index';

/** Вид оружия — он же ключ цвета. Цвета живут в `main.ts` рядом с остальной палитрой;
 *  здесь только вид, чтобы модуль не знал про канву. */
export type RangeKind = 'shuttle' | 'aa' | 'aim';

/** Круг досягаемости вокруг точки. `radius` в МИРОВЫХ единицах (масштаб накладывает
 *  рисующий), `radius === 0` для `aa` — у ПКО нет области, только отметка на узле. */
export interface RangeRing {
  kind: RangeKind;
  /** Мировые координаты центра. */
  x: number;
  y: number;
  radius: number;
  /** Кто это — для подписи/отладки: id флота или id мира. */
  sourceId: string;
}

export interface RangeOverlay {
  rings: RangeRing[];
}


/** Где сейчас объект на карте — передаётся снаружи, потому что положение флота в пути
 *  интерполируется рисующим (`fleetPos`), и второй копии этой математики тут не нужно. */
export type Locate = (id: string) => { x: number; y: number } | null;

/**
 * Разметка оверлея для ВЫДЕЛЕННЫХ флотов плюс отметки ПКО на видимых мирах.
 *
 * `visible` — фог-гейт: чужие зубы ПКО показываются только там, где мир опознан, иначе
 * оверлей стал бы разведкой (та же ошибка, что чинил RECAP-FOG). Свои миры видны всегда.
 */
export function combatRanges(
  state: GameState,
  data: GameData,
  selectedFleetIds: readonly string[],
  me: string,
  locate: Locate,
  visible: (planetId: string) => boolean,
): RangeOverlay {
  const rings: RangeRing[] = [];

  for (const id of selectedFleetIds) {
    const fleet: Fleet | undefined = state.fleets[id];
    if (!fleet) continue;
    const at = locate(id);
    if (!at) continue;

    const wing = shuttleStrikeRange(fleet, data);
    if (wing > 0) {
      rings.push({ kind: 'shuttle', x: at.x, y: at.y, radius: wing, sourceId: id });
    }
  }

  // Зубы ПКО — на мирах, а не у флотов, и без радиуса (см. шапку файла).
  for (const planet of Object.values(state.planets)) {
    if (aaStrength(planet, data) <= 0) continue;
    if (planet.owner !== me && !visible(planet.id)) continue;
    rings.push({
      kind: 'aa',
      x: planet.position.x,
      y: planet.position.y,
      radius: 0,
      sourceId: planet.id,
    });
  }

  return { rings };
}

/**
 * Круг ВЗВЕДЁННОГО ПРИЦЕЛА (остаток SHU-3.1) — докуда дотянется ЭТО звено с ЭТОЙ базы.
 *
 * Отдельно от `combatRanges`, потому что это другой вопрос. Тот отвечает «что вокруг
 * выделенного» и берёт `shuttleStrikeRange` — САМУЮ ДЛИННУЮ руку носителя; здесь взведён
 * конкретный приказ, и мерка у него `squadronReach` — САМАЯ КОРОТКАЯ рука соединения,
 * ровно та, по которой ядро отобьёт `E_OUT_OF_RANGE`. Числа честно разные: круг носителя
 * говорит, на что он способен в принципе, круг прицела — куда долетит взведённая эскадра.
 *
 * Звено без дальности круга не получает вовсе: «радиус 0» — не факт о мире, а линия ни о
 * чём (то же правило, что у блока вместимости в `hangarPanel.ts`).
 */
export function aimRing(
  aim: { squadron: Squadron; at: { x: number; y: number } } | null,
  data: GameData,
): RangeRing | null {
  if (!aim) return null;
  const radius = squadronReach(aim.squadron, data);
  if (radius <= 0) return null;
  return { kind: 'aim', x: aim.at.x, y: aim.at.y, radius, sourceId: aim.squadron.id };
}

/** Как выглядит кольцо: цвет живёт в палитре `main.ts`, здесь — заметность (правила 1–3). */
export interface RangeLook {
  alpha: number;
  dash: readonly [number, number];
  width: number;
}

/** Вид кольца по виду: ПКО заметнее радиуса вылета — у него нет области, только отметка.
 *  Взведённый прицел заметнее обоих: это не справка о базе, а режим, в котором игрок
 *  находится ПРЯМО СЕЙЧАС, и следующий тап по карте отправит машины. */
export function ringLook(kind: RangeKind): RangeLook {
  if (kind === 'aim') return { alpha: 0.85, dash: [7, 5], width: 1.6 };
  if (kind === 'aa') return { alpha: 0.7, dash: [2, 3], width: 1.2 };
  return { alpha: 0.32, dash: [5, 7], width: 1.2 };
}

/** Суммарная сила ПКО мира: стационарные установки зданий + ближняя зенитка гарнизона
 *  — обе шкалы, по которым бьёт `orbital.ts`. Ноль = зубов нет, отметки не будет. */
function aaStrength(planet: GameState['planets'][string], data: GameData): number {
  // ORB-1: нет орбитального слоя — нет и залпа по орбите (`orbital.ts` пропускает
  // такой узел целиком). Отметка на карте обязана молчать вместе с пушкой, иначе
  // оверлей обещает зубы, которых нет.
  if (!hasOrbit(data, planet)) return 0;
  let total = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (def) total += def.aaDamage ?? 0;
  }
  for (const st of planet.garrison) {
    const def = data.units[st.unit];
    if (def) total += (def.stats.aaDamage ?? 0) * st.count;
  }
  return total;
}
