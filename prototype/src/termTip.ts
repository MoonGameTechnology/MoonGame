/**
 * Подсказка к слову-термину (UIX-9.4) — браузерная половина `decisions/terms.ts`.
 *
 * Слово-термин — `<span class="term" data-term="id">` с пунктиром снизу; его статья —
 * статья справочника «Механика» (`codexIndex.ts`, `GLOSSARY`). Узлы подсказок — дети
 * `body`, поэтому термин работает в любом окне, где его нарисовали: хозяину экрана нужен
 * только `termHtml` (или `termTextHtml` для текста со ссылками `[[id|слово]]`). Внутри
 * подсказки термины тоже живые, и следующая подсказка встаёт поверх (стопка — `openTermAt`).
 *
 * 1. **Мышь:** подсказка встаёт при наведении, без задержки `title`, и держится, пока
 *    указатель на термине или на любой подсказке стопки. Ушёл со всего — гаснет через
 *    `TERM_GRACE_MS`: столько нужно, чтобы перевести указатель со слова на подсказку.
 * 2. **Касание:** термин переключает свою подсказку; касание мимо стопки закрывает всё
 *    и при этом делает своё дело. Касание самого термина — его собственное: ряд или окно
 *    под ним его не получают (кнопка внутри кнопки — не кнопка ни для кого).
 * 3. **Клавиатура:** фокус с клавиатуры открывает, Esc закрывает верхнюю подсказку и
 *    больше ничего — следующий Esc закроет уже окно.
 * 4. **Подсказка из подсказки не закрывает нижнюю:** она встаёт под ней или над ней целиком,
 *    у своего слова по горизонтали, — строки нижней ещё читают.
 * 5. **Термин исчез из разметки** (окно перерисовалось без него), страница прокрутилась
 *    или окно сменило размер — его подсказка и всё выше гаснут: подсказка, оставшаяся
 *    висеть над пустым местом, объясняла бы не то, что под ней.
 */
import { t } from '../../localization/runtime';
import { COMBAT_UNIT_CAP } from '../../packages/shared-core/src/index';
import { anchoredPopover } from '../../decisions/anchoredPopover';
import { openTermAt, parseTermRefs, stripTermRefs, toggleTermAt } from '../../decisions/terms';
import { GLOSSARY } from './codexIndex';
import { esc } from './format';

/** Пауза перед тем, как подсказка гаснет после ухода указателя (правило 1). */
export const TERM_GRACE_MS = 250;

/** Числа статей, которым они нужны: правило берёт их из ядра, а не из текста. */
const TERM_PARAMS: Record<string, () => Record<string, number>> = {
  'fire-line': () => ({ n: COMBAT_UNIT_CAP }),
};

const articleOf = (id: string) => GLOSSARY.find((g) => g.id === id);

/** Есть ли у термина статья. */
export const isTerm = (id: string): boolean => articleOf(id) !== undefined;

/** Заголовок статьи термина; неизвестный id — пустая строка. */
export function termTitle(id: string): string {
  const a = articleOf(id);
  return a ? t(a.titleKey) : '';
}

/** Текст статьи со ссылками на другие термины — для мест, где подсказка бывает. */
export function termBody(id: string): string {
  const a = articleOf(id);
  return a ? t(a.bodyKey, TERM_PARAMS[id]?.()) : '';
}

/** Текст статьи одними словами — для досье под курсором и прочих мест без подсказки. */
export function termPlain(id: string): string {
  return stripTermRefs(termBody(id));
}

/** Слово-термин: `label` — слово так, как оно стоит в строке (уже из локали). */
export function termHtml(id: string, label: string): string {
  return `<span class="term" data-term="${esc(id)}" tabindex="0">${esc(label)}</span>`;
}

/** Текст со ссылками `[[id|слово]]` как разметка: слова — термины, остальное экранировано. */
export function termTextHtml(text: string): string {
  return parseTermRefs(text, isTerm)
    .map((p) => (p.kind === 'term' ? termHtml(p.id, p.text) : esc(p.text)))
    .join('');
}

// --- Стопка подсказок в браузере ------------------------------------------------------
// Три параллельных массива одной длины: id статьи, узел подсказки и термин, у которого
// она встала. Меняются только через `trim` и `push`, поэтому разойтись не могут.
const stack: string[] = [];
const tips: HTMLElement[] = [];
const anchors: HTMLElement[] = [];
let grace = 0;
let watch = 0;
let pointerType = 'mouse';

/** Уровень, с которого открывает термин: 0 — на экране, N+1 — внутри N-й подсказки. */
function levelOf(el: Element): number {
  const tip = el.closest<HTMLElement>('.termtip');
  return tip ? Number(tip.dataset.level) + 1 : 0;
}

/** Оставить нижние `n` подсказок. */
function trim(n: number): void {
  while (tips.length > n) {
    tips.pop()!.remove();
    anchors.pop()!.removeAttribute('aria-describedby');
    stack.pop();
  }
  if (!tips.length && watch) {
    cancelAnimationFrame(watch);
    watch = 0;
  }
}

function push(id: string, anchor: HTMLElement): void {
  const level = tips.length;
  const tip = document.createElement('div');
  tip.className = 'termtip';
  tip.id = `termtip-${level}`;
  tip.setAttribute('role', 'tooltip');
  tip.dataset.level = String(level);
  tip.innerHTML = `<b>${esc(termTitle(id))}</b><p>${termTextHtml(termBody(id))}</p>`;
  tip.style.visibility = 'hidden';
  document.body.appendChild(tip);
  const r = anchor.getBoundingClientRect();
  // Подсказка из подсказки встаёт под (или над) ВСЕЙ нижней подсказкой, у слова по
  // горизонтали: под самим словом она закрыла бы строки, которые игрок ещё читает.
  const parent = level > 0 ? tips[level - 1]!.getBoundingClientRect() : r;
  const at = anchoredPopover(
    { left: r.left, top: parent.top, width: r.width, height: parent.height },
    { width: tip.offsetWidth, height: tip.offsetHeight },
    { width: innerWidth, height: innerHeight },
  );
  tip.style.left = `${at.left}px`;
  tip.style.top = `${at.top}px`;
  tip.style.maxHeight = at.maxHeight === null ? '' : `${at.maxHeight}px`;
  tip.style.visibility = '';
  anchor.setAttribute('aria-describedby', tip.id);
  tips.push(tip);
  anchors.push(anchor);
  stack.push(id);
  if (!watch) watch = requestAnimationFrame(watchAnchors);
}

/** Привести стопку к `next`, где всё выше `level` новое, а новый уровень — у `anchor`. */
function show(level: number, next: readonly string[], anchor: HTMLElement): void {
  const same = next.length > level && stack[level] === next[level] && anchors[level] === anchor;
  const keep = same ? level + 1 : Math.min(level, next.length);
  trim(keep);
  if (next.length > keep) push(next[keep]!, anchor);
}

/** Правило 5: подсказка термина, которого больше нет в разметке, гаснет вместе со всем выше. */
function watchAnchors(): void {
  const gone = anchors.findIndex((a) => !a.isConnected);
  if (gone >= 0) trim(gone);
  watch = tips.length ? requestAnimationFrame(watchAnchors) : 0;
}

function later(n: number): void {
  clearTimeout(grace);
  grace = window.setTimeout(() => trim(n), TERM_GRACE_MS);
}

function termOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-term]') : null;
}

function tipOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.termtip') : null;
}

let wired = false;

/** Подключить подсказки ко всему документу. Повторный вызов ничего не делает. */
export function initTermTips(): void {
  if (wired) return;
  wired = true;
  document.addEventListener(
    'pointerdown',
    (ev) => {
      pointerType = ev.pointerType || 'mouse';
    },
    true,
  );
  // Правило 1: наведение мышью.
  document.addEventListener('pointerover', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const el = termOf(ev.target);
    if (el?.dataset.term) {
      clearTimeout(grace);
      const level = levelOf(el);
      show(level, openTermAt(stack, level, el.dataset.term), el);
      return;
    }
    const tip = tipOf(ev.target);
    if (tip) {
      clearTimeout(grace);
      later(Number(tip.dataset.level) + 1);
    } else if (stack.length) later(0);
  });
  document.addEventListener('pointerout', (ev) => {
    if (ev.pointerType === 'mouse' && !ev.relatedTarget && stack.length) later(0);
  });
  // Правило 2: касание и клик. Фаза захвата — чтобы термин забрал своё касание раньше ряда.
  document.addEventListener(
    'click',
    (ev) => {
      const el = termOf(ev.target);
      if (el?.dataset.term) {
        ev.preventDefault();
        ev.stopPropagation();
        clearTimeout(grace);
        const level = levelOf(el);
        // Мышь уже открыла подсказку наведением: клик её не закрывает, иначе подсказка
        // мигала бы на каждом нажатии по слову.
        const next =
          pointerType === 'mouse'
            ? openTermAt(stack, level, el.dataset.term)
            : toggleTermAt(stack, level, el.dataset.term);
        show(level, next, el);
        return;
      }
      if (stack.length && !tipOf(ev.target)) trim(0);
    },
    true,
  );
  // Правило 3: клавиатура.
  document.addEventListener('focusin', (ev) => {
    const el = termOf(ev.target);
    const visible = ev.target instanceof Element && ev.target.matches(':focus-visible');
    if (!visible) return;
    if (el?.dataset.term) {
      const level = levelOf(el);
      show(level, openTermAt(stack, level, el.dataset.term), el);
    } else if (stack.length && !tipOf(ev.target)) trim(0);
  });
  document.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key === 'Escape' && stack.length) {
        ev.preventDefault();
        ev.stopPropagation();
        trim(stack.length - 1);
        return;
      }
      const el = termOf(ev.target);
      if (el?.dataset.term && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        ev.stopPropagation();
        const level = levelOf(el);
        show(level, toggleTermAt(stack, level, el.dataset.term), el);
      }
    },
    true,
  );
  // Правило 5: прокрутка (кроме прокрутки самой подсказки) и смена размера окна.
  document.addEventListener(
    'scroll',
    (ev) => {
      if (stack.length && !tipOf(ev.target)) trim(0);
    },
    true,
  );
  window.addEventListener('resize', () => trim(0));
}
