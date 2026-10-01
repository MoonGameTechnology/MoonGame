/**
 * RUS-3 — проводка моста RuStore. Решение (что показать, когда звать мост) проверено в
 * `decisions/storeUpdate.test.ts`; здесь держится то, что может сломаться именно в
 * проводах: вызов МЕТОДОМ моста, сохранение ДО перезапуска, сбой моста без падения игры.
 *
 * jsdom в репозитории нет (см. `spotlightDom.test.ts`), поэтому DOM — пара крошечных
 * подделок ровно под те узлы, которые трогает модуль.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../../localization/runtime';
import { initRuStoreUpdate, RUSTORE_EVENT } from './rustoreUpdate';

type Listener = (e: { detail?: unknown; preventDefault(): void }) => void;

class FakeNode {
  style = { display: 'none' };
  textContent = '';
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  addEventListener(type: string, fn: Listener): void {
    (this.listeners[type] ??= []).push(fn);
  }
  click(): void {
    for (const fn of this.listeners.click ?? []) fn({ preventDefault: () => {} });
  }
}

class FakeBar extends FakeNode {
  title = new FakeNode();
  querySelector(selector: string): FakeNode | null {
    return selector === '.ub-t span' ? this.title : null;
  }
}

const g = globalThis as Record<string, unknown>;
let nodes: Record<string, FakeNode>;
let windowListeners: Record<string, Listener[]>;

/** Мост, который ведёт себя как объект Java-моста: метод работает только с `this`. */
function bridge(opts: { throwOn?: string } = {}) {
  const calls: string[] = [];
  const self = {
    calls,
    checkUpdate(this: unknown) {
      if (this !== self) throw new Error('detached call');
      if (opts.throwOn === 'checkUpdate') throw new Error('bridge down');
      calls.push('checkUpdate');
    },
    startUpdate(this: unknown) {
      if (this !== self) throw new Error('detached call');
      calls.push('startUpdate');
    },
    completeUpdate(this: unknown) {
      if (this !== self) throw new Error('detached call');
      calls.push('completeUpdate');
    },
  };
  g.VoidRuStore = self;
  return self;
}

const emit = (detail: unknown): void => {
  for (const fn of windowListeners[RUSTORE_EVENT] ?? []) fn({ detail, preventDefault: () => {} });
};
const bar = (): FakeBar => nodes.updbar as FakeBar;

beforeEach(() => {
  nodes = {
    updbar: new FakeBar(),
    'ub-go': new FakeNode(),
    'ub-later': new FakeNode(),
    'ub-ver': new FakeNode(),
  };
  windowListeners = {};
  g.document = { getElementById: (id: string) => nodes[id] ?? null };
  g.window = {
    addEventListener: (type: string, fn: Listener) => (windowListeners[type] ??= []).push(fn),
  };
});

afterEach(() => {
  delete g.document;
  delete g.window;
  delete g.VoidRuStore;
});

describe('RUS-3 — проводка моста RuStore', () => {
  it('нет моста — проводки нет, и это не ошибка', () => {
    expect(initRuStoreUpdate()).toBeNull();
    expect(windowListeners[RUSTORE_EVENT]).toBeUndefined();
  });

  it('проверка зовёт мост МЕТОДОМ — оторванная функция Java-моста не вызывается', () => {
    const b = bridge();
    initRuStoreUpdate()!.check();
    expect(b.calls).toEqual(['checkUpdate']);
  });

  it('обновление есть — баннер с предложением скачать, подписи из локали', () => {
    bridge();
    initRuStoreUpdate()!.check();
    emit({ type: 'check', available: true });
    expect(bar().style.display).toBe('block');
    expect(bar().title.attrs['data-i18n']).toBe('upd.available');
    expect(nodes['ub-go']!.textContent).toBe(t('upd.go'));
  });

  it('«Обновить» открывает диалог магазина, «Позже» прячет баннер', () => {
    const b = bridge();
    initRuStoreUpdate()!.check();
    emit({ type: 'check', available: true });
    nodes['ub-go']!.click();
    expect(b.calls).toEqual(['checkUpdate', 'startUpdate']);
    expect(bar().style.display).toBe('none');
  });

  it('скачано → «Перезапустить»: сначала сохранение, потом установка', () => {
    const b = bridge();
    const order: string[] = [];
    initRuStoreUpdate({ beforeRestart: () => order.push(`save:${b.calls.length}`) })!.check();
    emit({ type: 'check', available: true });
    nodes['ub-go']!.click();
    emit({ type: 'flow', accepted: true });
    emit({ type: 'install', status: 'downloaded' });
    expect(nodes['ub-go']!.attrs['data-i18n']).toBe('upd.restart');
    expect(bar().title.textContent).toBe(t('upd.ready'));
    nodes['ub-go']!.click();
    expect(order).toEqual(['save:2']); // сохранение — до третьего вызова моста
    expect(b.calls).toEqual(['checkUpdate', 'startUpdate', 'completeUpdate']);
  });

  it('сохранение упало — перезапуска нет, прогресс важнее', () => {
    const b = bridge();
    const store = initRuStoreUpdate({
      beforeRestart: () => {
        throw new Error('disk full');
      },
    })!;
    store.check();
    emit({ type: 'check', available: true });
    nodes['ub-go']!.click();
    emit({ type: 'install', status: 'downloaded' });
    const quiet = console.error;
    console.error = () => {};
    try {
      nodes['ub-go']!.click();
    } finally {
      console.error = quiet;
    }
    expect(b.calls).not.toContain('completeUpdate');
    expect(bar().style.display).toBe('none');
  });

  it('мост бросил — игра не падает, баннера нет', () => {
    bridge({ throwOn: 'checkUpdate' });
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(() => initRuStoreUpdate()!.check()).not.toThrow();
    } finally {
      console.error = quiet;
    }
    expect(bar().style.display).toBe('none');
  });

  it('битое событие моста ничего не двигает', () => {
    bridge();
    initRuStoreUpdate()!.check();
    emit({ type: 'check', available: 'yes' });
    emit('available');
    expect(bar().style.display).toBe('none');
  });
});
