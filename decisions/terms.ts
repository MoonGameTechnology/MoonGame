/**
 * Термины в тексте: ссылка на статью словаря и стопка подсказок (UIX-9.4, UIX-5.4).
 *
 * Словарь — статьи справочника «Механика» (ключи `codex.term.<id>.*`): одно объяснение на
 * понятие, и его видит каждое место, где понятие встречается, — подсказка у слова,
 * всплывашка параметра флота, досье под курсором на ПК, поиск справочника. Здесь две
 * вещи, общие обоим клиентам и проверяемые без браузера.
 *
 * 1. **Ссылка на термин пишется в самом тексте локали:** `[[defense|защитой]]` — id статьи
 *    и слово так, как оно стоит в предложении. Падеж и порядок слов решает текст, а не
 *    код: код, склеивающий «защит» + окончание, сломался бы на первом же языке.
 * 2. **Неизвестный id — просто текст.** Опечатка в ссылке не роняет экран и не показывает
 *    игроку скобки: он прочтёт слово и потеряет только подсказку (опечатку ловит тест
 *    локали, `prototype/src/termTip.test.ts`).
 * 3. **Там, где подсказки не бывает** (досье под курсором, холст), ссылка снимается до
 *    слова: скобок игрок не видит нигде.
 * 4. **Подсказки встают стопкой, как у Paradox:** термин внутри подсказки открывает
 *    следующую ПОВЕРХ, а не вместо неё. Открытие на уровне N закрывает всё выше N: ветка,
 *    по которой ушёл игрок, остаётся, соседняя гаснет.
 * 5. **Статью, уже открытую ниже по стопке, второй раз не открыть.** «Атака» в «защите» в
 *    «атаке» дала бы бесконечную лестницу из двух статей. Стопка не выше `TERM_DEPTH`:
 *    четвёртый уровень пояснений игрок уже не читает.
 */

/** Кусок текста: обычный текст или слово-термин со ссылкой на статью. */
export type TermPart = { kind: 'text'; text: string } | { kind: 'term'; id: string; text: string };

/** `[[id|слово]]`: id — как у статьи (`fire-line`), слово — без скобок и черты. */
const REF = /\[\[([a-z0-9-]+)\|([^\]|]+)\]\]/g;

/** Разбор текста на куски (правила 1–2). Соседние текстовые куски склеены. */
export function parseTermRefs(text: string, known: (id: string) => boolean): TermPart[] {
  const out: TermPart[] = [];
  const pushText = (s: string): void => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += s;
    else out.push({ kind: 'text', text: s });
  };
  let at = 0;
  for (const m of text.matchAll(REF)) {
    pushText(text.slice(at, m.index));
    const id = m[1]!;
    const word = m[2]!;
    if (known(id)) out.push({ kind: 'term', id, text: word });
    else pushText(word);
    at = m.index + m[0].length;
  }
  pushText(text.slice(at));
  return out;
}

/** Текст без ссылок — только слова (правило 3). */
export function stripTermRefs(text: string): string {
  return text.replace(REF, '$2');
}

/** id всех ссылок текста по порядку — для проверки локали. */
export function termRefIds(text: string): string[] {
  return [...text.matchAll(REF)].map((m) => m[1]!);
}

/** Сколько подсказок может стоять стопкой (правило 5). */
export const TERM_DEPTH = 4;

/**
 * Открыть статью `id` с уровня `level` (0 — термин на экране, N — термин в N-й подсказке).
 * Всё выше `level` закрывается (правило 4); статья, уже открытая ниже, и переполненная
 * стопка оставляют только нижние уровни (правило 5).
 */
export function openTermAt(stack: readonly string[], level: number, id: string): string[] {
  const base = stack.slice(0, Math.max(0, Math.min(level, stack.length)));
  if (base.includes(id) || base.length >= TERM_DEPTH) return base;
  return [...base, id];
}

/** Касание термина: открыть его статью, а если она уже открыта с этого уровня — закрыть. */
export function toggleTermAt(stack: readonly string[], level: number, id: string): string[] {
  return stack[level] === id ? stack.slice(0, level) : openTermAt(stack, level, id);
}
