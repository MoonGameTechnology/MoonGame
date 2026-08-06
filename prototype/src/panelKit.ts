/**
 * Кирпичики боковой панели: кнопка, шапка карточки, вкладка, колонки (REFM-35).
 *
 * Панель собирается строкой и уходит в `innerHTML`, поэтому КАЖДОЕ значение, пришедшее
 * из данных или состояния, обязано пройти экранирование — иначе имя мира или юнита
 * становится разметкой (CWE-79). Здесь это правило выполняется в одном месте, а не в
 * трёхстах строках шаблонов.
 *
 * Второе правило, которое легко потерять при правке вёрстки: **недоступная кнопка
 * помечается `disabled`, а не прячется.** Игрок должен видеть, что действие существует,
 * и узнать из досье, почему оно сейчас не работает.
 */
import { esc } from './format';

/** Кнопка действия панели. `ok = false` → видна, но нажать нельзя. */
export function actionButton(
  act: string,
  arg: string,
  label: string,
  ok: boolean,
  desc?: string,
): string {
  const d = desc ? ` data-desc="${esc(desc)}"` : '';
  return `<button class="b" data-act="${esc(act)}" data-arg="${esc(arg)}"${d} ${ok ? '' : 'disabled'}>${esc(label)}</button>`;
}

/** Обернуть секцию так, чтобы многоколоночная раскладка ПК не разорвала её по колонкам. */
export function block(inner: string): string {
  return `<div class="block">${inner}</div>`;
}

/** Разложить секции в отзывчивое тело панели: рядом на широком экране, стопкой на телефоне. */
export function pcols(blocks: readonly string[]): string {
  return `<div class="pcols">${blocks.map(block).join('')}</div>`;
}

/**
 * Шапка карточки. `compact` — ПК-раскладка: однострочная шапка обрезает подпись, поэтому
 * пробелы вокруг разделителей убираются и в строку влезает больше. `titleAct` делает имя
 * кнопкой (Bytro-стиль: тап по имени открывает сводку) — без него это просто заголовок,
 * и прочие панели не меняются.
 */
export function cardHeader(
  color: string,
  title: string,
  sub: string,
  opts: { compact?: boolean; titleAct?: string } = {},
): string {
  const subFit = opts.compact ? sub.replace(/ · /g, '·') : sub;
  const tt = opts.titleAct
    ? `<button class="ptitle-btn" data-act="${esc(opts.titleAct)}" data-arg="">${esc(title)} ▸</button>`
    : `<b>${esc(title)}</b>`;
  return `<div class="phead">
    <span class="pflag" style="background:${color}"></span>
    <div class="ptitle">${tt}<span>${esc(subFit)}</span></div>
    <button class="pclose" data-act="close" data-arg="">✕</button>
  </div>`;
}

/** Вкладка карточки мира со счётчиком. Активная помечается классом, а не исчезновением. */
export function tabButton(
  tab: string,
  label: string,
  count: number,
  active: boolean,
  desc?: string,
): string {
  const d = desc ? ` data-desc="${esc(desc)}"` : '';
  return `<button class="ptab${active ? ' on' : ''}" data-act="tab" data-arg="${esc(tab)}"${d}>${label}<b>${count}</b></button>`;
}

/** Как показать одну строку состава: иконка, подпись и к какому домену относится юнит. */
export interface UnitRowView {
  icon: string;
  name: string;
  domain: string;
}

/**
 * Строки состава (гарнизон, трюм, десант). Пустой список говорит об этом СЛОВАМИ:
 * пустое место в панели читается как поломка, а не как «здесь никого».
 */
export function unitRows(
  stacks: ReadonlyArray<{ unit: string; count: number }>,
  view: (unit: string) => UnitRowView,
  emptyLabel: string,
): string {
  if (!stacks.length) return `<div class="row dim">${esc(emptyLabel)}</div>`;
  return stacks
    .map((st) => {
      const v = view(st.unit);
      return (
        `<div class="asset-row" data-desc="u:${esc(st.unit)}">` +
        `<span class="bicon">${v.icon}</span>` +
        `<b>${st.count}× ${esc(v.name)}</b>` +
        `<span class="dim">${esc(v.domain)}</span>` +
        `</div>`
      );
    })
    .join('');
}
