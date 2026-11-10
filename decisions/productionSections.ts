/**
 * Окно «Производство» открывается списком линий мира, а каталог появляется только по
 * нажатию на линию (заказ владельца 2026-11-09, макет «сначала линии»). Линия окна — это
 * конвейер ядра (`BUILD_LANES`): что игрок видит строкой в списке, туда же ядро и ставит
 * заказ. Раньше над каталогом стояли ещё и вкладки «Постройки / Производство /
 * Мобилизация», которые вели в те же четыре места под другими именами; второй путь снят.
 *
 * Раздел (`ProductionSection`) — подвкладка каталога внутри линии. Разделов у линии
 * столько, сколько родов она строит: у верфи корабли и поддержка, у мобилизации пехота,
 * техника и герои. Порядок разделов задаёт и порядок подвкладок, первым открывается первый.
 */
export type ProductionLane = 'buildings' | 'ships' | 'shuttles' | 'mobilization';

export type ProductionSection =
  | 'buildings'
  | 'ships'
  | 'support'
  | 'squads'
  | 'infantry'
  | 'vehicles'
  | 'heroes';

/** Линии в порядке списка: стройка первой, потом юниты, как `BUILD_LANES` ядра. */
export const PRODUCTION_LANES: readonly ProductionLane[] = ['buildings', 'ships', 'shuttles', 'mobilization'];

/** Разделы каталога каждой линии. */
export const LANE_SECTIONS: Readonly<Record<ProductionLane, readonly ProductionSection[]>> = {
  buildings: ['buildings'],
  ships: ['ships', 'support'],
  shuttles: ['squads'],
  mobilization: ['infantry', 'vehicles', 'heroes'],
};

/** Линия, в каталоге которой стоит раздел. */
export function laneOfSection(section: ProductionSection): ProductionLane {
  for (const lane of PRODUCTION_LANES) if (LANE_SECTIONS[lane].includes(section)) return lane;
  return 'buildings';
}

/** Раздел, на котором открывается линия: прежний, если он из этой же линии (вернулся к
 *  линии — стоишь там, где был), иначе первый раздел линии. */
export function sectionForLane(lane: ProductionLane, previous?: ProductionSection): ProductionSection {
  const sections = LANE_SECTIONS[lane];
  return previous && sections.includes(previous) ? previous : sections[0]!;
}
