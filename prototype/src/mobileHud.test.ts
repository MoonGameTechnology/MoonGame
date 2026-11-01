/**
 * Лист телефона (`mobileHud.ts`) пишется каждый кадр. Здесь проверено, что кадр без перемен
 * ничего в листе не переписывает: тот же `hidden`, атрибут или текст, записанный заново, браузер
 * заново стилизует, и на слабом телефоне это стоило пересчёта стилей в каждом кадре.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { initMobileHud, type MobileChoice } from './mobileHud';

/** Узел страницы: ровно то, что лист трогает у DOM, и счёт записей в него. */
class FakeEl {
  writes = 0;
  id = '';
  type = '';
  className = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  parentNode: FakeEl | null = null;
  children: FakeEl[] = [];
  /** Что вернёт `querySelector` по селектору. */
  found: Record<string, FakeEl> = {};
  private hide = false;
  private text = '';
  private off = false;
  private readonly attrs = new Map<string, string>();
  private readonly classes = new Set<string>();
  readonly classList = {
    toggle: (name: string, force: boolean) => {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      return force;
    },
    contains: (name: string) => this.classes.has(name),
  };
  get hidden(): boolean {
    return this.hide;
  }
  set hidden(v: boolean) {
    this.hide = v;
    this.writes++;
  }
  get textContent(): string {
    return this.text;
  }
  set textContent(v: string) {
    this.text = v;
    this.writes++;
  }
  get disabled(): boolean {
    return this.off;
  }
  set disabled(v: boolean) {
    this.off = v;
    this.writes++;
  }
  get firstChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    this.writes++;
  }
  appendChild(child: FakeEl): FakeEl {
    return this.insertBefore(child, null);
  }
  insertBefore(child: FakeEl, ref: FakeEl | null): FakeEl {
    const from = child.parentNode?.children;
    from?.splice(from.indexOf(child), 1);
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(child);
    else this.children.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  addEventListener(): void {}
  querySelector(selector: string): FakeEl | null {
    return this.found[selector] ?? null;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Лист над карточкой своего мира: имя в шапке карточки и кнопка метки. */
function boot() {
  const made: FakeEl[] = [];
  const make = (): FakeEl => {
    const el = new FakeEl();
    made.push(el);
    return el;
  };
  const body = make();
  vi.stubGlobal('document', { createElement: make, createComment: make, body });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  const page = make();
  const side = page.appendChild(make());
  const commands = page.appendChild(make());
  side.appendChild(make());
  const name = make();
  name.textContent = 'Деймос';
  side.found['.ptitle > :first-child'] = name;
  side.found['[data-act="ping"]'] = make();
  const noop = (): void => {};
  const hud = initMobileHud({
    side: side as unknown as HTMLElement,
    commands: commands as unknown as HTMLElement,
    dismiss: noop,
    choose: noop,
    ping: noop,
    summary: noop,
    describe: noop,
    resized: noop,
    tab: noop,
  });
  hud.sync(true);
  const sheet = body.children.find((el) => el.id === 'mobile-sheet')!;
  return { hud, sheet, writes: () => made.reduce((n, el) => n + el.writes, 0) };
}

it('кадр без перемен ничего не переписывает в листе', () => {
  const { hud, writes } = boot();
  const choice: MobileChoice = { kind: 'fleet', id: 'f1', title: 'Флот', sub: '3' };
  const frames: Array<Parameters<typeof hud.update>> = [
    ['', false, false, []], // ничего не выбрано: лист спрятан
    ['planet:A', false, false, [], 'fleet'], // свой мир со своим флотом: вкладки
    ['planet:A', true, false, []], // режим приказа
    ['planet:A', false, false, [choice]], // выбор из нескольких под пальцем
  ];
  for (const frame of frames) {
    hud.update(...frame);
    const before = writes();
    hud.update(...frame);
    hud.update(...frame);
    expect(writes(), JSON.stringify(frame)).toBe(before);
  }
});

it('перемена по-прежнему доходит до листа', () => {
  const { hud, sheet } = boot();
  hud.update('planet:A', false, false, []);
  expect(sheet.hidden).toBe(false);
  hud.update('', false, false, []);
  expect(sheet.hidden).toBe(true);
});
