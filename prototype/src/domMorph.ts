/**
 * Перерисовка окна без замены узлов, когда разметка того же устройства.
 *
 * `innerHTML` снимает и ставит заново каждый узел, а снятый ползунок теряет палец посреди
 * протяжки. Если новая разметка совпадает со старой по дереву тегов, здесь меняются
 * только атрибуты и текст, а сами узлы остаются. Иначе — обычная замена целиком.
 */

function sameShape(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  if (a.childNodes.length !== b.childNodes.length) return false;
  for (let i = 0; i < a.childNodes.length; i++) {
    if (!sameShape(a.childNodes[i]!, b.childNodes[i]!)) return false;
  }
  return true;
}

function patch(old: Node, next: Node): void {
  if (old.nodeType === Node.TEXT_NODE) {
    if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
    return;
  }
  if (old instanceof Element && next instanceof Element) {
    for (const attr of Array.from(old.attributes)) {
      if (!next.hasAttribute(attr.name)) old.removeAttribute(attr.name);
    }
    for (const attr of Array.from(next.attributes)) {
      if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
    }
    // У ползунка значение живёт отдельно от атрибута: его ставит модель, а не палец.
    if (old instanceof HTMLInputElement && next instanceof HTMLInputElement && old.value !== next.value) {
      old.value = next.value;
    }
  }
  for (let i = 0; i < old.childNodes.length; i++) patch(old.childNodes[i]!, next.childNodes[i]!);
}

/** Положить `html` в `host`, сохранив узлы, если дерево тегов то же. */
export function morphInto(host: HTMLElement, html: string): void {
  if (typeof host.ownerDocument?.createElement !== 'function') {
    host.innerHTML = html; // тесты окон без браузера
    return;
  }
  const next = host.ownerDocument.createElement(host.tagName);
  next.innerHTML = html;
  if (host.childNodes.length === 0 || !sameShape(host, next)) {
    host.innerHTML = html;
    return;
  }
  for (let i = 0; i < host.childNodes.length; i++) patch(host.childNodes[i]!, next.childNodes[i]!);
}
