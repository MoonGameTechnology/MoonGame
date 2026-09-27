/**
 * Куда поставить всплывашку, привязанную к элементу: под ним, над ним, по краю экрана.
 *
 * Первая такая всплывашка — надбавки параметра флота (тап по «Атаке» в окне флота): она
 * должна стоять у числа, которое объясняет, и при этом не уезжать за край экрана ни у
 * параметра в шапке окна, ни у параметра в самом низу листа на телефоне.
 *
 * 1. **Под элементом, если помещается.** Палец и курсор приходят сверху, и всплывашка
 *    под числом не закрывает само число — его и читают вместе со строками.
 * 2. **Не помещается под — над элементом, если там помещается.** Иначе — туда, где места
 *    больше, и высота режется по этому месту: прокрутка внутри всплывашки лучше, чем
 *    строки, уехавшие за край.
 * 3. **По горизонтали — левым краем к элементу**, но целиком в экране: сдвиг внутрь, а
 *    не обрезка. Всплывашка шире экрана прижимается к левому полю.
 * 4. **Поля от края экрана одинаковы со всех сторон** (`margin`), зазор до элемента —
 *    отдельный (`gap`): иначе рамка всплывашки сливается с рамкой кнопки.
 */

export interface PopRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PopSize {
  width: number;
  height: number;
}

export interface PopPlacement {
  left: number;
  top: number;
  /** Где встала всплывашка относительно элемента — для стрелки и анимации. */
  side: 'below' | 'above';
  /** Предел высоты (правило 2); `null` — помещается целиком. */
  maxHeight: number | null;
}

export interface PopOptions {
  /** Поле от края экрана. */
  margin?: number;
  /** Зазор между элементом и всплывашкой. */
  gap?: number;
}

export function anchoredPopover(
  anchor: PopRect,
  pop: PopSize,
  viewport: PopSize,
  { margin = 8, gap = 6 }: PopOptions = {},
): PopPlacement {
  const below = viewport.height - margin - (anchor.top + anchor.height + gap);
  const above = anchor.top - gap - margin;
  const side: PopPlacement['side'] =
    pop.height <= below || (pop.height > above && below >= above) ? 'below' : 'above';
  const room = Math.max(0, side === 'below' ? below : above);
  const height = Math.min(pop.height, room);
  const top = side === 'below' ? anchor.top + anchor.height + gap : anchor.top - gap - height;
  const maxLeft = viewport.width - margin - pop.width;
  const left = Math.max(margin, Math.min(anchor.left, maxLeft));
  return { left, top, side, maxHeight: height < pop.height ? room : null };
}
