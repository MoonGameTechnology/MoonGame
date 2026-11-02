// Листы игры, вынесенные из строки `css` в `build.mjs` (SLIM-2): там ~5 000 строк стилей жили
// внутри JS-шаблона. Каждый лист — обычный CSS в `prototype/styles/`, номер в имени — его
// место в каскаде: правило ниже перебивает правило выше, поэтому листы не переставляют.
// Порядок собирает `build.mjs`; сторожа, которые читают стили как текст, берут `gameCss()`.
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('./styles/', import.meta.url);

/** Имена листов в порядке каскада (по номеру в имени). */
export const GAME_SHEETS = readdirSync(DIR)
  .filter((name) => name.endsWith('.css'))
  .sort();

/** Текст одного листа из `prototype/styles/`. */
export const gameSheet = (name) => readFileSync(new URL(name, DIR), 'utf8');

/** Все листы одной строкой, в порядке каскада. */
export const gameCss = () => GAME_SHEETS.map(gameSheet).join('');
