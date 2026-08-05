/**
 * REFM-17 — цвет стороны: ОДНА палитра, два представления.
 *
 * «Цвет = отношение»: другой командир красится по ТВОЕЙ стойке к нему, а не по личному
 * цвету. Представлений у этого правила два, и они РАЗНЫЕ по назначению:
 *
 *  · **карта** различает три состояния — враг / дружественный блок / мир. Пакт и союз
 *    на карте намеренно сливаются: с высоты провинции важно «свой это или нет», а не
 *    степень близости.
 *  · **дипломатический экран** различает все четыре стойки: там из них ВЫБИРАЮТ, и
 *    чипы обязаны быть различимы между собой.
 *
 * До этого кирпича у каждого представления была СВОЯ таблица цветов (`RELATION_SCHEMES`
 * и `STANCE_COLOR` в `main.ts`), и расходились они не косметически: настройку палитры
 * («классическая» / «тёплая» / `cvd`) знала только карта. То есть игрок с цветослепотой
 * переключался на CVD-палитру, получал безопасные оттенки на карте — и тут же видел
 * дипломатический экран в исходных: зелёный «союз» рядом с красной «войной», ровно ту
 * красно-зелёную ловушку, ради которой палитра и заводилась. Теперь таблица одна, а
 * представления — две функции над ней.
 */
import type { DiplomaticStance } from '../../packages/shared-core/src/index';

/** Политическая палитра мест (Bytro/Paradox-стиль): ты — зелёный, враг — красный. */
export const COLOR: Record<string, string> = {
  p1: '#3ad17a', // you — green
  p2: '#ff5a4d',
  p3: '#ffb43a',
  p4: '#b07cff',
  p5: '#35d6e6',
  p6: '#ff7ac8',
  p7: '#9ed85a',
  p8: '#e58b4a',
  p9: '#6f9cff',
  p10: '#d8cf5a',
  ally: '#4a8cff', // friendly bloc (pact / alliance) — blue
  null: '#6f8a93', // unowned territory — gray
};

/** Пустое пространство — провинции, которые нельзя захватить. */
export const VOID_COLOR = '#46606e';

/**
 * Цвета одной палитры. Четыре стойки — для экрана дипломатии, `bloc` — для карты,
 * которая пакт и союз не различает.
 */
export interface SideScheme {
  war: string;
  peace: string;
  pact: string;
  alliance: string;
  /** «Дружественный блок» на карте: пакт и союз одним цветом. */
  bloc: string;
}

/**
 * `cvd` — оттенки, различимые при цветослепоте (Okabe–Ito). Красный враг против
 * зелёного союзника — классическая красно-зелёная ловушка, поэтому там вермилион
 * против двух синих: небесный (пакт) и глубокий (союз) различимы и между собой.
 */
export const RELATION_SCHEMES: Record<string, SideScheme> = {
  classic: {
    war: '#ff5a4d',
    peace: '#9fb8c0',
    pact: '#35d6e6',
    alliance: '#5ff0a8',
    bloc: COLOR.ally!,
  },
  warm: {
    war: '#ff6a3a',
    peace: '#a8a29a',
    pact: '#2fb5c9',
    alliance: '#67e0b0',
    bloc: '#2fb5c9',
  },
  cvd: {
    war: '#d55e00', // вермилион
    peace: '#9a9a9a',
    pact: '#56b4e9', // небесно-синий
    alliance: '#0072b2', // синий
    bloc: '#0072b2',
  },
};

/** Палитра по id; незнакомый id (в том числе подделанный в хранилище) — классическая. */
export function paletteOf(id: string | null | undefined): SideScheme {
  return (typeof id === 'string' ? RELATION_SCHEMES[id] : undefined) ?? RELATION_SCHEMES.classic!;
}

/** Есть ли такая палитра — для валидации выбора перед сохранением. */
export function isPaletteId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(RELATION_SCHEMES, id);
}

/**
 * Цвета сторон уходят в инлайновый `style="color:…"` и в `<input type=color value>`, то
 * есть значение обязано быть литеральным `#rrggbb`, а не свободным текстом. Приходят они
 * из `<input type="color">` (там форма уже ограничена), но круг делают через
 * localStorage, который враждебное расширение/страница могут подменить. Проверяем на
 * ВХОДЕ, поэтому каждый приёмник ниже безопасен по построению: подменённое значение
 * вырождается в умолчание, а не втекает разметкой (CWE-79 / CodeQL js/xss-through-dom).
 * Умолчание — доверенная константа, идёт как есть.
 */
export function safeHexColor(c: string | null | undefined, fallback: string): string {
  // Проверяющий ГВАРД (а не пересборка строки): значение используется, только если
  // совпало с `#rrggbb` — шаблоном, в котором не может быть метасимволов HTML, — поэтому
  // в инлайновых приёмниках оно инертно. Всё остальное вырождается в умолчание. Именно
  // форму гварда анализ помеченных данных распознаёт как санитайзер.
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;
}

/**
 * Цвет на КАРТЕ. Пакт и союз — один «дружественный блок»: с высоты провинции важно
 * «свой или нет», а не степень близости.
 */
export function relationColor(stance: DiplomaticStance, scheme: SideScheme): string {
  switch (stance) {
    case 'war':
      return scheme.war;
    case 'pact':
    case 'alliance':
      return scheme.bloc;
    default: // мир (война-по-умолчанию попадает в ветку выше, не сюда)
      return scheme.peace;
  }
}

/** Цвет на экране ДИПЛОМАТИИ: четыре стойки, четыре различимых цвета. */
export function stanceColor(stance: DiplomaticStance, scheme: SideScheme): string {
  return scheme[stance];
}
