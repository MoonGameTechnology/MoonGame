/**
 * Тестовый DOM для живых узлов (`liveTimers.ts`): разметка окна → то, что увидит игрок после
 * `patchLiveTimers`. Под Node браузера нет, а проверять надо обе половины: что в разметке
 * нет цифр (она не меняется с часами) и что живой патч ставит верные цифры.
 */
import { patchLiveTimers, type LiveFormats } from './liveTimers';

const LIVE = /\bpn-(timer|tip|bar|pct)\b/;
const unesc = (v: string): string =>
  v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

interface FakeLive {
  classes: string[];
  dataset: Record<string, string>;
  textContent: string;
  title: string;
  style: { width: string };
  attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
}

/** Разметка `html` после живого патча к моменту `now`: цифры на месте «…», ширина полос и
 *  подсказки — атрибутами. */
export function liveRender(html: string, now: number, formats?: LiveFormats): string {
  const nodes: FakeLive[] = [];
  const TAG = /<([a-z]+)\b([^>]*)>(…)?/g;
  for (const [, , attrs] of html.matchAll(TAG)) {
    const cls = /\bclass="([^"]*)"/.exec(attrs!)?.[1] ?? '';
    if (!LIVE.test(cls)) continue;
    const dataset: Record<string, string> = {};
    for (const [, k, v] of attrs!.matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)) dataset[k!] = unesc(v!);
    const el: FakeLive = {
      classes: cls.split(/\s+/),
      dataset,
      textContent: '…',
      title: '',
      style: { width: '' },
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
    };
    nodes.push(el);
  }
  const root = {
    querySelectorAll: (sel: string) => nodes.filter((n) => n.classes.includes(sel.slice(1))),
  } as unknown as ParentNode;
  patchLiveTimers(root, now, formats);
  let i = 0;
  return html.replace(TAG, (whole, tag: string, attrs: string, dots?: string) => {
    const cls = /\bclass="([^"]*)"/.exec(attrs)?.[1] ?? '';
    if (!LIVE.test(cls)) return whole;
    const el = nodes[i++]!;
    const extra =
      (el.title ? ` title="${el.title}"` : '') + (el.style.width ? ` style="width:${el.style.width}"` : '');
    return `<${tag}${attrs}${extra}>${dots !== undefined ? el.textContent : ''}`;
  });
}
