/** Buildable space hulls the «Корабли» pane fits; shuttle/carrier hulls → «Челноки». */
export const YARD_HULLS = [
  'cruiser',
  'heavy_cruiser',
  'scout',
  'frigate',
  'picket_frigate',
  // ROS-3.2: «Шаттл» — КОРАБЛЬ, который возит челноки, а не челнок. Он заказывается
  // среди кораблей, как и всякий корпус со своей линией боя.
  'shuttle_carrier',
];
export const YARD_SQUAD_HULLS = ['interceptor', 'bomber', 'heavy_striker', 'landing_shuttle'];

/** Наземный ростер экрана — тот же набор, что предлагает панель мира. РАЗДЕЛЯЕТ его по
 *  вкладкам не второй список, а ДАННЫЕ (`UnitDef.kind`, ROS-1.1): новый род войск или
 *  переезд корпуса из пехоты в технику решается юнитом, а не правкой интерфейса. */
export const YARD_GROUND_HULLS = ['militia', 'heavy_infantry', 'special_forces', 'tank'];

export const PRODUCTION_UNITS = [...YARD_HULLS, ...YARD_SQUAD_HULLS, ...YARD_GROUND_HULLS];
