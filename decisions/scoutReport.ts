/**
 * Разведка в журнале событий (решение владельца 2026-11-01): впервые опознанная чужая
 * цель пишется туда со всем, что о ней известно в этот миг.
 *
 * 1. **Пишется ПЕРВОЕ опознание, а не каждое.** Мир у края радара мигает «виден / не
 *    виден» при каждом шаге флота; строка на каждое возвращение засыпала бы журнал одним и
 *    тем же миром. Память о том, что цель уже названа, принадлежит матчу.
 * 2. **Первый взгляд партии — точка отсчёта, а не новость.** На старте (и после загрузки)
 *    игрок уже видит соседей; десяток строк «разведан мир» в первую секунду — шум. Всё,
 *    что видно на первом кадре, запоминается молча.
 * 3. **Цель — только чужая и не союзная.** Свои миры разведывать незачем, союзник
 *    делится картой сам, а ничейный пустой мир — не цель.
 * 4. **Называется то, что видно, и только оно.** Гарнизон, постройки с уровнями и флоты
 *    на орбите — ровно то, что панель мира показывает опознанному узлу. Флот, стоящий у
 *    названного мира, входит в строку мира и отдельной строки не получает.
 */
import type { ReportPart } from './battleReport';

/** Что видно на опознанном чужом мире. */
export interface ScoutView {
  garrison: number;
  /** Постройки: уже переведённое имя и уровень. */
  buildings: readonly { name: string; level: number }[];
  /** Чужие флоты на орбите и кораблей в них. */
  fleets: number;
  ships: number;
}

/** Новые цели (правило 1): опознанные сейчас, ещё не названные и прошедшие `isTarget`.
 *  `seen` не меняется — запомнить решает зовущий. */
export function freshTargets(
  seen: ReadonlySet<string>,
  now: Iterable<string>,
  isTarget: (id: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const id of now) if (!seen.has(id) && isTarget(id)) out.push(id);
  return out;
}

/** Части строки о мире (правило 4). Порядок постоянный: гарнизон, постройки, орбита. */
export function scoutParts(v: ScoutView): ReportPart[] {
  const parts: ReportPart[] = [
    v.garrison > 0 ? { key: 'log.scout.garrison', params: { n: v.garrison } } : { key: 'log.scout.no-garrison' },
  ];
  parts.push(
    v.buildings.length > 0
      ? { key: 'log.scout.buildings', params: { list: v.buildings.map((b) => `${b.name} ${b.level}`).join(', ') } }
      : { key: 'log.scout.no-buildings' },
  );
  if (v.fleets > 0) parts.push({ key: 'log.scout.orbit', params: { n: v.fleets, k: v.ships } });
  return parts;
}
