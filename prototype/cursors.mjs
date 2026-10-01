// Курсор игры вместо системного: тёмный корпус-дротик со светлой окантовкой. Над
// интерактивным он «нагревается» — окантовка желтеет, корпус тлеет изнутри, как
// раскалённый металл. Обычный CSS-курсор (картинка), а не DOM-спрайт за указателем:
// браузер рисует его сам, без кадра JS и без задержки за мышью.
//
// Сенсорный экран курсора не показывает — правило безвредно на телефоне.

/** Остриё дротика: и хотспот курсора, и вершина пути. */
const TIP = { x: 3, y: 2 };

/** Дротик: остриё вверху слева, хвост — зазубрина, а не «ножка» системной стрелки. */
const DART = 'M3 2 L25 13.4 L15.2 15.6 L11 26 Z';
/** Килевая линия от острия к зазубрине — та самая деталь, что отличает от системного. */
const KEEL = 'M5.6 5.2 L14.6 15';

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`;

/** Холодный: корпус цвета пустоты (`--void`), окантовка — `--ink`, киль — `--cyan`. */
export const COLD_SVG = svg(
  `<path d="${DART}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="3.6" stroke-linejoin="round"/>` +
    `<path d="${DART}" fill="#030810" stroke="#bfeee6" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="${KEEL}" stroke="#35d6e6" stroke-width="1.1" stroke-linecap="round"/>`,
);

/** Нагретый: ореол жара, корпус тлеет от зазубрины к острию, окантовка добела. */
export const HOT_SVG = svg(
  '<defs><radialGradient id="h" cx="9" cy="9" r="17" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="#ff8a2a"/><stop offset=".45" stop-color="#b8300c"/>' +
    '<stop offset="1" stop-color="#2a0703"/></radialGradient></defs>' +
    `<path d="${DART}" fill="none" stroke="#ff6a1a" stroke-opacity=".45" stroke-width="4.4" stroke-linejoin="round"/>` +
    `<path d="${DART}" fill="url(#h)" stroke="#ffe7a8" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="${KEEL}" stroke="#fff4d0" stroke-width="1.1" stroke-linecap="round"/>`,
);

const url = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}") ${TIP.x} ${TIP.y}`;

/** Значения свойства `cursor` с системным запасным — на случай, если картинку не взяли. */
export const COLD_CURSOR = `${url(COLD_SVG)},default`;
export const HOT_CURSOR = `${url(HOT_SVG)},pointer`;

/**
 * Лист курсоров. Ставится ПЕРВЫМ: базовые правила здесь по элементам, и любое явное
 * правило ниже (`not-allowed`, `grab`, `help`) их перекрывает, как и раньше.
 */
export const cursorCss = () => `
:root{--cur-cold:${COLD_CURSOR};--cur-hot:${HOT_CURSOR};}
html,body{cursor:var(--cur-cold);}
a[href],button,select,summary,label[for],[role="button"],[role="tab"],
input[type="button"],input[type="submit"],input[type="checkbox"],input[type="radio"],input[type="range"]{cursor:var(--cur-hot);}
button:disabled,[aria-disabled="true"]{cursor:var(--cur-cold);}
textarea,input:not([type]),input[type="text"],input[type="search"],input[type="number"],
input[type="email"],input[type="password"],input[type="url"],[contenteditable="true"]{cursor:text;}
#map.cur-hot{cursor:var(--cur-hot);}
`;

/**
 * Всё, что листы уже помечают `cursor:pointer`, нагревается тем же курсором: правок
 * в двух сотнях правил нет, и новое правило с `pointer` получит нагрев само.
 */
export const heatPointers = (css) => css.replace(/cursor:\s*pointer\b/g, 'cursor:var(--cur-hot)');
